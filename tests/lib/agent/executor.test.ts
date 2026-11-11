import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolError } from "@/lib/agent/errors";
import { confirmAction, CONFIRM_TTL_MS, executeToolCall, rejectAction, runConfirmedAction } from "@/lib/agent/executor";
import { assignRefs, resolveRefs } from "@/lib/agent/refs";
import { createRegistry, TOOLS, toOpenAITools } from "@/lib/agent/tools/registry";
import type { DestructiveTool, NormalTool } from "@/lib/agent/tools/types";
import { QuotaExceededError } from "@/lib/llm/openai";
import { memoryDb, toolContext } from "./memory-store";

describe("short refs", () => {
  it("numbers new targets per user and reuses existing refs", async () => {
    const { storeFor } = memoryDb();
    const store = storeFor("u1");
    const first = await assignRefs(store, "posting", ["p1", "p2", "p1"]);
    expect([...first.values()].sort()).toEqual(["J1", "J2"]);
    const again = await assignRefs(store, "posting", ["p2", "p3"]);
    expect(again.get("p2")).toBe(first.get("p2"));
    expect(again.get("p3")).toBe("J3");
    expect((await assignRefs(storeFor("u2"), "posting", ["p9"])).get("p9")).toBe("J1");
  });

  it("uses the winner's ref when a concurrent request assigned one first", async () => {
    const { storeFor } = memoryDb();
    const store = storeFor("u1");
    const racing = { ...store, insertRef: async (ref: string, kind: "posting", id: string) => (await store.insertRef("J77", kind, id), false) };
    expect((await assignRefs(racing, "posting", ["p1"])).get("p1")).toBe("J77");
  });

  it("rejects malformed, wrong-kind and unknown refs with messages the model can act on", async () => {
    const { storeFor } = memoryDb();
    const store = storeFor("u1");
    await assignRefs(store, "posting", ["p1"]);
    await expect(resolveRefs(store, ["j1 "], ["posting"])).resolves.toEqual([{ ref: "J1", kind: "posting", targetId: "p1" }]);
    await expect(resolveRefs(store, ["123e4567-e89b-12d3-a456-426614174000"], ["posting"])).rejects.toMatchObject({ code: "bad_ref" });
    await expect(resolveRefs(store, ["J1"], ["application"])).rejects.toMatchObject({ code: "wrong_ref_kind" });
    await expect(resolveRefs(store, ["J2"], ["posting"])).rejects.toMatchObject({ code: "unknown_ref", message: expect.stringContaining("J2") });
  });

  it("treats another session's refs as unknown (ownership)", async () => {
    const { storeFor } = memoryDb();
    await assignRefs(storeFor("victim"), "application", ["victim-app"]);
    await expect(resolveRefs(storeFor("attacker"), ["A1"], ["application"])).rejects.toMatchObject({ code: "unknown_ref" });
  });
});

// --- Executor --------------------------------------------------------------------------------

let ran: unknown[] = [];
const echo: NormalTool<{ text: string }> = {
  name: "echo",
  description: "test",
  destructive: false,
  input: z.object({ text: z.string().max(10) }).strict(),
  async run(args) {
    ran.push(args);
    if (args.text === "boom") throw new Error("database exploded at secret-host:5432");
    if (args.text === "typed") throw new ToolError("not_found", "No such thing.");
    if (args.text === "quota") throw new QuotaExceededError(500);
    return { forModel: { echoed: args.text }, forUI: { kind: "echo", text: args.text }, summary: `echoed ${args.text}` };
  },
};

let executed: unknown[] = [];
const wipe: DestructiveTool<{ ids: string[] }, { ids: string[] }> = {
  name: "wipe",
  description: "test",
  destructive: true,
  input: z.object({ ids: z.array(z.string()).min(1) }).strict(),
  resolved: z.object({ ids: z.array(z.string()) }).strict(),
  async prepare(args) {
    if (args.ids.includes("none")) throw new ToolError("nothing_matched", "Nothing matches.");
    return { resolved: { ids: args.ids.map((id) => `resolved-${id}`) }, preview: { title: `Wipe ${args.ids.length}?`, count: args.ids.length, items: [] } };
  },
  async execute(resolved) {
    executed.push(resolved);
    return { forModel: { wiped: resolved.ids.length }, summary: `wiped ${resolved.ids.length}` };
  },
};

const registry = createRegistry([echo, wipe]);

function setup(userId = "u1") {
  ran = [];
  executed = [];
  const memory = memoryDb();
  const store = memory.storeFor(userId);
  return { ...memory, store, ctx: toolContext(store) };
}

describe("executeToolCall", () => {
  it("validates, runs and logs a normal tool", async () => {
    const { ctx, db } = setup();
    const outcome = await executeToolCall(registry, "echo", '{"text":"hi"}', ctx);
    expect(outcome).toMatchObject({ status: "executed", forModel: { echoed: "hi" }, forUI: { kind: "echo" }, summary: "echoed hi" });
    expect(db.actions).toHaveLength(1);
    expect(db.actions[0]).toMatchObject({ tool: "echo", args: { text: "hi" }, status: "executed", resultSummary: "echoed hi", turnId: ctx.turnId });
    expect(db.actions[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ["an unknown tool", "rm_rf", "{}", "unknown_tool"],
    ["arguments that aren't JSON", "echo", "{text: hi", "bad_json"],
    ["a wrong type", "echo", '{"text": 5}', "invalid_arguments"],
    ["an extra field", "echo", '{"text":"hi","admin":true}', "invalid_arguments"],
    ["a value over the limit", "echo", '{"text":"far too long text"}', "invalid_arguments"],
  ])("rejects %s before anything runs, and logs it as invalid", async (_label, name, args, code) => {
    const { ctx, db } = setup();
    const outcome = await executeToolCall(registry, name, args, ctx);
    expect(outcome.status).toBe("invalid");
    expect(outcome.forModel).toMatchObject({ error: { code } });
    expect(ran).toEqual([]);
    expect(db.actions[0].status).toBe("invalid");
  });

  it("returns typed tool errors to the model, and hides unexpected ones", async () => {
    const { ctx, db } = setup();
    expect((await executeToolCall(registry, "echo", '{"text":"typed"}', ctx)).forModel).toEqual({ error: { code: "not_found", message: "No such thing." } });
    expect((await executeToolCall(registry, "echo", '{"text":"quota"}', ctx)).forModel).toMatchObject({ error: { code: "ai_limit" } });
    const crash = await executeToolCall(registry, "echo", '{"text":"boom"}', ctx);
    expect(crash.status).toBe("failed");
    expect(JSON.stringify(crash.forModel)).not.toContain("secret-host");
    expect(db.actions[2].error).toContain("secret-host"); // full detail stays in the audit log
  });

  it("never runs a destructive tool from the model's call: it stores the resolved args and a preview", async () => {
    const { ctx, db } = setup();
    const outcome = await executeToolCall(registry, "wipe", '{"ids":["a","b"]}', ctx);
    expect(executed).toEqual([]);
    expect(outcome.status).toBe("awaiting_confirmation");
    expect(outcome.pending).toMatchObject({ tool: "wipe", preview: { title: "Wipe 2?", count: 2 } });
    expect(outcome.forModel).toMatchObject({ status: "awaiting_user_confirmation" });
    expect(db.actions[0]).toMatchObject({ status: "awaiting_confirmation", destructive: true, resolvedArgs: { ids: ["resolved-a", "resolved-b"] } });
    expect(Date.parse(db.actions[0].expiresAt!) - ctx.now().getTime()).toBe(CONFIRM_TTL_MS);
  });

  it("logs a destructive proposal that can't be prepared as failed, with no pending action", async () => {
    const { ctx, db } = setup();
    const outcome = await executeToolCall(registry, "wipe", '{"ids":["none"]}', ctx);
    expect(outcome).toMatchObject({ status: "failed", forModel: { error: { code: "nothing_matched" } } });
    expect(outcome.pending).toBeUndefined();
    expect(db.actions[0].status).toBe("failed");
  });
});

describe("confirmation flow (PLAN 4.5)", () => {
  async function proposed(userId = "u1") {
    const context = setup(userId);
    const outcome = await executeToolCall(registry, "wipe", '{"ids":["a"]}', context.ctx);
    return { ...context, actionId: outcome.actionId };
  }

  it("can't run a destructive executor without a confirmed record", async () => {
    const { ctx, actionId } = await proposed();
    await expect(runConfirmedAction(registry, crypto.randomUUID(), ctx)).rejects.toThrow("no confirmation record");
    await expect(runConfirmedAction(registry, actionId, ctx)).rejects.toThrow("awaiting_confirmation, not confirmed");
    expect(executed).toEqual([]);
  });

  it("refuses to run a confirmed record for a tool that isn't destructive", async () => {
    const { ctx, store } = setup();
    const id = await store.insertAction({ turnId: ctx.turnId, tool: "echo", destructive: false, args: {}, status: "confirmed" });
    await expect(runConfirmedAction(registry, id, ctx)).rejects.toThrow("not a destructive tool");
  });

  it("runs the STORED resolved args on confirm, logs it, and notes it for the next turn", async () => {
    const { ctx, actionId, db } = await proposed();
    // Tampering with the original model args after the preview changes nothing.
    db.actions[0].args = { ids: ["everything"] };
    const outcome = await confirmAction(registry, actionId, ctx);
    expect(outcome.status).toBe("executed");
    expect(executed).toEqual([{ ids: ["resolved-a"] }]);
    expect(db.actions[0].status).toBe("executed");
    expect(db.messages.at(-1)).toMatchObject({ role: "system", content: expect.stringContaining('confirmed "Wipe 1"') });
  });

  it("runs only once on a double click", async () => {
    const { ctx, actionId } = await proposed();
    const [first, second] = await Promise.all([confirmAction(registry, actionId, ctx), confirmAction(registry, actionId, ctx)]);
    expect([first.status, second.status].sort()).toEqual(["already_handled", "executed"]);
    expect(executed).toHaveLength(1);
  });

  it("refuses an expired action and marks it expired", async () => {
    const { ctx, actionId, db } = await proposed();
    const later = { ...ctx, now: () => new Date(ctx.now().getTime() + CONFIRM_TTL_MS + 1) };
    expect((await confirmAction(registry, actionId, later)).status).toBe("expired");
    expect(db.actions[0].status).toBe("expired");
    expect(executed).toEqual([]);
  });

  it("doesn't let another user confirm or cancel the action", async () => {
    const { actionId, storeFor } = await proposed("owner");
    const attacker = toolContext(storeFor("attacker"));
    expect((await confirmAction(registry, actionId, attacker)).status).toBe("not_found");
    expect((await rejectAction(actionId, attacker)).status).toBe("not_found");
    expect(executed).toEqual([]);
  });

  it("cancels: marks the action rejected, runs nothing, and a later confirm is refused", async () => {
    const { ctx, actionId, db } = await proposed();
    expect((await rejectAction(actionId, ctx)).status).toBe("rejected");
    expect(db.actions[0].status).toBe("rejected");
    expect((await confirmAction(registry, actionId, ctx)).status).toBe("already_handled");
    expect((await rejectAction(actionId, ctx)).status).toBe("already_handled");
    expect(executed).toEqual([]);
    expect(db.messages.at(-1)?.content).toContain("cancelled");
  });

  it("logs a confirmed action that fails as failed", async () => {
    const failing = createRegistry([{ ...wipe, execute: async () => Promise.reject(new Error("storage down")) }]);
    const { ctx, actionId, db } = await proposed();
    const outcome = await confirmAction(failing, actionId, ctx);
    expect(outcome).toMatchObject({ status: "failed", error: expect.stringContaining("Nothing may have changed") });
    expect(db.actions[0]).toMatchObject({ status: "failed", error: "storage down" });
  });
});

describe("registry", () => {
  it("has the 15 planned tools, with destructive flags exactly where PLAN 4.8 puts them", () => {
    const tools = createRegistry();
    expect(tools.size).toBe(15);
    expect(TOOLS.filter((tool) => tool.destructive).map((tool) => tool.name).sort()).toEqual(["archive_applications", "delete_applications", "delete_files"]);
  });

  it("rejects duplicate tool names", () => {
    expect(() => createRegistry([echo, echo])).toThrow("duplicate tool echo");
  });

  it("generates OpenAI function definitions from the zod schemas", () => {
    const definitions = toOpenAITools(createRegistry());
    const search = definitions.find((tool) => tool.name === "search_jobs")!;
    expect(search).toMatchObject({ type: "function", strict: false, parameters: { type: "object", additionalProperties: false, required: ["query"] } });
    expect(search.parameters).not.toHaveProperty("$schema");
    for (const definition of definitions) expect(definition.description!.length).toBeGreaterThan(20);
  });
});
