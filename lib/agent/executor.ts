import type { z } from "zod";
import { QuotaExceededError } from "@/lib/llm/openai";
import { ToolError } from "./errors";
import type { ActionRecord, ActionStatus } from "./store";
import type { Registry } from "./tools/registry";
import type { DestructiveTool, Preview, ToolContext, ToolResult, UiPayload } from "./tools/types";

/** Pending destructive actions expire after 15 minutes (PLAN 4.5). */
export const CONFIRM_TTL_MS = 15 * 60 * 1000;

export type PendingAction = { actionId: string; tool: string; preview: Preview; expiresAt: string };

export type ToolCallOutcome = {
  actionId: string;
  tool: string;
  status: Extract<ActionStatus, "executed" | "failed" | "invalid" | "awaiting_confirmation">;
  /** What goes back to the model: the tool's small result, a pending notice, or `{ error }`. */
  forModel: unknown;
  forUI?: UiPayload;
  pending?: PendingAction;
  summary: string;
  durationMs: number;
};

const MAX_LOGGED_ARGS = 4_000;

function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(arguments)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Runs one model tool call: log "proposed" → parse → validate (zod) → resolve refs and check
 * ownership (inside the tool) → run, or for destructive tools store the resolved args + preview
 * as "awaiting_confirmation" and stop. Every outcome is logged with its duration. Errors become
 * typed results the model can act on; nothing here throws for a bad call.
 */
export async function executeToolCall(registry: Registry, name: string, rawArgs: string, ctx: ToolContext): Promise<ToolCallOutcome> {
  const started = Date.now();
  const tool = registry.get(name);
  const parsed = parseArgs(rawArgs);
  const loggedArgs = parsed.ok ? parsed.value : { raw: rawArgs.slice(0, MAX_LOGGED_ARGS) };
  const actionId = await ctx.store.insertAction({ turnId: ctx.turnId, tool: name.slice(0, 64), destructive: tool?.destructive ?? false, args: loggedArgs, status: "proposed" });

  const finish = async (status: ToolCallOutcome["status"], result: Omit<ToolCallOutcome, "actionId" | "tool" | "status" | "durationMs">, error: string | null = null) => {
    const durationMs = Date.now() - started;
    await ctx.store.updateAction(actionId, { status, resultSummary: result.summary.slice(0, 500), error, durationMs });
    return { actionId, tool: name, status, durationMs, ...result };
  };
  const reject = (code: string, message: string) => finish("invalid", { forModel: { error: { code, message } }, summary: `invalid: ${message}`.slice(0, 500) }, message);

  if (!tool) return reject("unknown_tool", `There is no tool named "${name}".`);
  if (!parsed.ok) return reject("bad_json", "The arguments were not valid JSON.");
  const args = tool.input.safeParse(parsed.value);
  if (!args.success) return reject("invalid_arguments", zodMessage(args.error));

  try {
    if (tool.destructive) {
      const { resolved, preview } = await tool.prepare(args.data, ctx);
      const expiresAt = new Date(ctx.now().getTime() + CONFIRM_TTL_MS).toISOString();
      const durationMs = Date.now() - started;
      await ctx.store.updateAction(actionId, { status: "awaiting_confirmation", resolvedArgs: resolved, preview, expiresAt, resultSummary: preview.title, durationMs });
      const pending = { actionId, tool: name, preview, expiresAt };
      return {
        actionId,
        tool: name,
        status: "awaiting_confirmation",
        durationMs,
        summary: preview.title,
        pending,
        forModel: {
          status: "awaiting_user_confirmation",
          action: preview.title,
          count: preview.count,
          note: "Nothing has changed yet. The user must press Confirm in the dialog. Do not say it is done.",
        },
      };
    }
    const result: ToolResult = await tool.run(args.data, ctx);
    return finish("executed", { forModel: result.forModel, forUI: result.forUI, summary: result.summary });
  } catch (error) {
    return finish("failed", ...failure(error));
  }
}

/** Typed tool errors go to the model as-is; anything else is logged in full but shown generically. */
function failure(error: unknown): [Omit<ToolCallOutcome, "actionId" | "tool" | "status" | "durationMs">, string] {
  if (error instanceof ToolError) return [{ forModel: { error: { code: error.code, message: error.message } }, summary: `failed: ${error.message}` }, error.message];
  if (error instanceof QuotaExceededError) return [{ forModel: { error: { code: "ai_limit", message: error.message } }, summary: "failed: AI limit reached" }, error.message];
  const detail = error instanceof Error ? error.message : String(error);
  return [{ forModel: { error: { code: "internal_error", message: "The tool hit an unexpected error. Tell the user it failed; don't retry." } }, summary: "failed: internal error" }, detail.slice(0, 1000)];
}

// ---------------------------------------------------------------------------------------------
// Confirmation (PLAN 4.5)

export type ConfirmOutcome =
  | { status: "executed"; action: ActionRecord; result: ToolResult }
  | { status: "failed"; action: ActionRecord; error: string }
  | { status: "rejected"; action: ActionRecord }
  | { status: "not_found" | "expired" | "already_handled"; action: ActionRecord | null };

/**
 * Runs a destructive tool for a confirmed action. Throws unless the stored record exists, belongs
 * to this user (the store is user-scoped), is for this tool and is in status "confirmed". This is
 * the only path to `execute`, and it uses the STORED resolved args, never new model output.
 */
export async function runConfirmedAction(registry: Registry, actionId: string, ctx: ToolContext): Promise<ToolResult> {
  const action = await ctx.store.getAction(actionId);
  if (!action) throw new Error("no confirmation record for this action");
  if (action.status !== "confirmed") throw new Error(`action is ${action.status}, not confirmed`);
  const tool = registry.get(action.tool);
  if (!tool || !tool.destructive) throw new Error(`${action.tool} is not a destructive tool`);
  const resolved = (tool as DestructiveTool<unknown, unknown>).resolved.parse(action.resolvedArgs);
  return tool.execute(resolved, ctx);
}

/**
 * The user pressed Confirm. One conditional update claims the action (awaiting_confirmation,
 * not expired → confirmed), so a double click or a replay can't run it twice. Then the stored
 * args run, the outcome is logged, and a system note tells the next turn what happened.
 */
export async function confirmAction(registry: Registry, actionId: string, ctx: ToolContext): Promise<ConfirmOutcome> {
  const started = Date.now();
  const claimed = await ctx.store.claimAction(actionId, ctx.now().toISOString());
  if (!claimed) {
    const action = await ctx.store.getAction(actionId);
    if (!action) return { status: "not_found", action: null };
    if (action.status === "awaiting_confirmation") {
      await ctx.store.updateAction(actionId, { status: "expired" });
      await ctx.store.addMessage(action.turnId, "system", `The proposed action "${previewTitle(action)}" expired before it was confirmed. Nothing changed.`);
      return { status: "expired", action: { ...action, status: "expired" } };
    }
    return { status: "already_handled", action };
  }

  try {
    const result = await runConfirmedAction(registry, actionId, ctx);
    await ctx.store.updateAction(actionId, { status: "executed", resultSummary: result.summary.slice(0, 500), durationMs: Date.now() - started });
    await ctx.store.addMessage(claimed.turnId, "system", `The user confirmed "${previewTitle(claimed)}". Result: ${result.summary}.`);
    return { status: "executed", action: { ...claimed, status: "executed" }, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.store.updateAction(actionId, { status: "failed", error: message.slice(0, 1000), durationMs: Date.now() - started });
    await ctx.store.addMessage(claimed.turnId, "system", `The user confirmed "${previewTitle(claimed)}", but it failed. Nothing may have changed.`);
    return { status: "failed", action: { ...claimed, status: "failed" }, error: "The action failed. Nothing may have changed; try again." };
  }
}

/** The user pressed Cancel. */
export async function rejectAction(actionId: string, ctx: ToolContext): Promise<ConfirmOutcome> {
  const rejected = await ctx.store.rejectAction(actionId);
  if (!rejected) {
    const action = await ctx.store.getAction(actionId);
    return action ? { status: "already_handled", action } : { status: "not_found", action: null };
  }
  await ctx.store.addMessage(rejected.turnId, "system", `The user cancelled "${previewTitle(rejected)}". Nothing changed.`);
  return { status: "rejected", action: rejected };
}

function previewTitle(action: ActionRecord): string {
  const title = (action.preview as Preview | null)?.title;
  return (title ?? action.tool).replace(/\?$/, "");
}
