import type { ResponseInputItem, ResponseOutputItem } from "openai/resources/responses/responses";
import { QuotaExceededError, type CreateResponse } from "@/lib/llm/openai";
import type { AgentPrompt } from "@/prompts/types";
import { executeToolCall, type PendingAction, type ToolCallOutcome } from "./executor";
import { buildState, renderState } from "./state";
import { toOpenAITools, type Registry } from "./tools/registry";
import type { Preview, ToolContext, UiPayload } from "./tools/types";

/** PLAN 4.4 / 4.9. */
export const MAX_TOOL_CALLS = 6;
const MAX_MODEL_CALLS = 8;
/** Last 3 turns of final text (user + assistant + any system notes). */
const HISTORY_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_FINAL_CHARS = 4_000;

/** Ordered events the UI renders as a timeline. Streaming later only changes the transport (PLAN 4.4). */
export type TurnEvent =
  | { type: "step_started"; step: number; tool: string; args: unknown }
  | { type: "step_done"; step: number; tool: string; status: ToolCallOutcome["status"]; summary: string; durationMs: number; actionId: string }
  | { type: "source_status"; step: number; sources: unknown; usedSnapshot: boolean }
  | { type: "ui_payload"; step: number; payload: UiPayload }
  | { type: "pending_action"; step: number; actionId: string; tool: string; preview: Preview; expiresAt: string }
  | { type: "error"; code: "ai_limit" | "ai_unavailable"; message: string }
  | { type: "final"; text: string };

export type TurnResult = { turnId: string; events: TurnEvent[]; final: string; toolCalls: number; modelCalls: number; usage: { input: number; output: number } };

export type TurnDeps = {
  ctx: ToolContext;
  registry: Registry;
  create: CreateResponse;
  model: string;
  prompt: AgentPrompt;
  /** Stop calling tools after this time and answer with what we have. */
  toolDeadline: number;
};

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(0, 500);
  }
}

/** A code-written answer for when the model gives none (or isn't reachable). Facts only. */
function fallbackText(outcomes: ToolCallOutcome[], pending: PendingAction[]): string {
  const done = outcomes.filter((outcome) => outcome.status === "executed").map((outcome) => outcome.summary);
  const parts = done.length ? [`Done: ${done.join("; ")}.`] : [];
  if (pending.length) parts.push(`Waiting for you to confirm: ${pending.map((item) => item.preview.title).join("; ")}`);
  return parts.join(" ") || "I couldn't complete that. Please try again.";
}

/**
 * One agent turn: system prompt + state block + the last few turns + the user's message, then up
 * to MAX_TOOL_CALLS validated, logged tool calls, then a final answer. After a destructive tool
 * proposes an action, or at a limit or the deadline, the model must answer without more tools.
 */
export async function runTurn(message: string, deps: TurnDeps): Promise<TurnResult> {
  const { ctx } = deps;
  const events: TurnEvent[] = [];
  const outcomes: ToolCallOutcome[] = [];
  const pending: PendingAction[] = [];
  const usage = { input: 0, output: 0 };
  const failuresByTool = new Map<string, number>();
  let stopTools = false;

  const [state, history] = await Promise.all([buildState(ctx.store, ctx.now(), ctx.timezone), ctx.store.recentMessages(HISTORY_MESSAGES)]);
  await ctx.store.addMessage(ctx.turnId, "user", message.slice(0, MAX_MESSAGE_CHARS));

  const instructions = `${deps.prompt.instructions}\n\n${renderState(state)}`;
  const input: ResponseInputItem[] = [
    ...history.map(
      (item): ResponseInputItem =>
        item.role === "system"
          ? { role: "developer", content: `App note: ${item.content.slice(0, MAX_MESSAGE_CHARS)}` }
          : { role: item.role, content: item.content.slice(0, MAX_MESSAGE_CHARS) },
    ),
    { role: "user", content: message.slice(0, MAX_MESSAGE_CHARS) },
  ];
  const tools = toOpenAITools(deps.registry);

  let final = "";
  let modelCalls = 0;
  while (modelCalls < MAX_MODEL_CALLS) {
    const mustAnswer = stopTools || pending.length > 0 || outcomes.length >= MAX_TOOL_CALLS || Date.now() >= deps.toolDeadline || modelCalls === MAX_MODEL_CALLS - 1;
    let response;
    try {
      modelCalls++;
      response = await deps.create({
        model: deps.model,
        instructions,
        input,
        tools,
        tool_choice: mustAnswer ? "none" : "auto",
        parallel_tool_calls: true,
        reasoning: { effort: "low" },
        include: ["reasoning.encrypted_content"],
        store: false,
        max_output_tokens: 2_000,
      });
    } catch (error) {
      const quota = error instanceof QuotaExceededError;
      const text = quota ? `${error.message} ${fallbackText(outcomes, pending)}` : `The AI service isn't responding right now. ${fallbackText(outcomes, pending)}`;
      events.push({ type: "error", code: quota ? "ai_limit" : "ai_unavailable", message: quota ? error.message : "The AI service isn't responding right now." });
      final = text;
      break;
    }
    usage.input += response.usage?.input_tokens ?? 0;
    usage.output += response.usage?.output_tokens ?? 0;

    const output: ResponseOutputItem[] = response.output ?? [];
    const calls = output.filter((item) => item.type === "function_call");
    if (calls.length === 0 || mustAnswer) {
      final = response.output_text.trim();
      break;
    }

    input.push(...(output as ResponseInputItem[]));
    for (const call of calls) {
      let result: unknown;
      if (outcomes.length >= MAX_TOOL_CALLS || stopTools || pending.length > 0) {
        // Not run: over the per-turn cap, or a destructive action is already waiting.
        result = { error: { code: pending.length ? "awaiting_confirmation" : "tool_limit", message: pending.length ? "Another action is waiting for confirmation; answer the user now." : `Only ${MAX_TOOL_CALLS} tool calls per turn; answer with what you have.` } };
      } else {
        const step = outcomes.length + 1;
        events.push({ type: "step_started", step, tool: call.name, args: parseArgs(call.arguments) });
        const outcome = await executeToolCall(deps.registry, call.name, call.arguments, ctx);
        outcomes.push(outcome);
        events.push({ type: "step_done", step, tool: call.name, status: outcome.status, summary: outcome.summary, durationMs: outcome.durationMs, actionId: outcome.actionId });
        if (outcome.forUI) {
          if (outcome.forUI.kind === "search") events.push({ type: "source_status", step, sources: outcome.forUI.sources, usedSnapshot: Boolean(outcome.forUI.usedSnapshot) });
          events.push({ type: "ui_payload", step, payload: outcome.forUI });
        }
        if (outcome.pending) {
          pending.push(outcome.pending);
          events.push({ type: "pending_action", step, ...outcome.pending });
        }
        // Each tool gets one fix attempt (PLAN 4.4 rule 5): a second failure of the same tool ends tool use.
        if (outcome.status === "invalid" || outcome.status === "failed") {
          const failures = (failuresByTool.get(call.name) ?? 0) + 1;
          failuresByTool.set(call.name, failures);
          if (failures >= 2) stopTools = true;
        }
        result = outcome.forModel;
      }
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    }
  }

  if (!final) final = fallbackText(outcomes, pending);
  // Code-side guard for the confirmation rule: the answer must point at the dialog.
  if (pending.length && !/confirm/i.test(final)) final += `\n\nNothing has changed yet: press Confirm in the dialog to go ahead, or Cancel.`;
  final = final.slice(0, MAX_FINAL_CHARS);

  events.push({ type: "final", text: final });
  await ctx.store.addMessage(ctx.turnId, "assistant", final);
  return { turnId: ctx.turnId, events, final, toolCalls: outcomes.length, modelCalls, usage };
}
