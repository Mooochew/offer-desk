import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ResponseOutputItem } from "openai/resources/responses/responses";
import { runTurn, MAX_TOOL_CALLS } from "@/lib/agent/loop";
import { buildState } from "@/lib/agent/state";
import { createRegistry } from "@/lib/agent/tools/registry";
import type { DestructiveTool, NormalTool } from "@/lib/agent/tools/types";
import { QuotaExceededError, type CreateResponse, type LlmResponse } from "@/lib/llm/openai";
import { SYSTEM_V1 } from "@/prompts/system-v1";
import { memoryDb, toolContext } from "./memory-store";

type Step = { calls?: { name: string; args: unknown }[]; text?: string } | Error;

/** Fake model: each request gets the next scripted step. Records requests (plain function, not vi.fn). */
function scriptedModel(steps: Step[]) {
  const requests: Parameters<CreateResponse>[0][] = [];
  const create: CreateResponse = async (params) => {
    requests.push(structuredClone(params));
    const step = steps[Math.min(requests.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    const output: ResponseOutputItem[] = (step.calls ?? []).map((call, index) => ({
      type: "function_call",
      call_id: `call_${requests.length}_${index}`,
      name: call.name,
      arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args),
    })) as ResponseOutputItem[];
    // With tool_choice "none" a real model can't call tools; the fake answers with text then.
    const text = params.tool_choice === "none" ? step.text ?? "Done." : step.text ?? "";
    return { output_text: text, output, usage: { input_tokens: 100, output_tokens: 10 } } satisfies LlmResponse;
  };
  return { create, requests };
}

let runs = 0;
const ping: NormalTool<{ n?: number }> = {
  name: "ping",
  description: "test tool",
  destructive: false,
  input: z.object({ n: z.number().optional() }).strict(),
  async run(args) {
    runs++;
    return { forModel: { pong: args.n ?? 0 }, forUI: { kind: "search", sources: [{ source: "greenhouse" }], usedSnapshot: false }, summary: "pong" };
  },
};
const nuke: DestructiveTool<Record<string, never>, { ok: true }> = {
  name: "nuke",
  description: "test destructive tool",
  destructive: true,
  input: z.object({}).strict(),
  resolved: z.object({ ok: z.literal(true) }),
  prepare: async () => ({ resolved: { ok: true }, preview: { title: "Nuke 3 things?", count: 3, items: [] } }),
  execute: async () => {
    throw new Error("must not run in a turn");
  },
};
const registry = createRegistry([ping, nuke]);

function setup(steps: Step[], overrides: { toolDeadline?: number } = {}) {
  runs = 0;
  const memory = memoryDb();
  const store = memory.storeFor("u1");
  const model = scriptedModel(steps);
  const ctx = toolContext(store);
  const deps = { ctx, registry, create: model.create, model: "m", prompt: SYSTEM_V1, toolDeadline: overrides.toolDeadline ?? Date.now() + 60_000 };
  return { ...memory, store, ctx, model, deps };
}

describe("runTurn", () => {
  it("runs tool calls, feeds results back by call_id, and returns ordered events and the final text", async () => {
    const { deps, model, db } = setup([{ calls: [{ name: "ping", args: { n: 1 } }, { name: "ping", args: { n: 2 } }] }, { text: "Two pongs." }]);
    const result = await runTurn("ping twice", deps);

    expect(result.final).toBe("Two pongs.");
    expect(result.toolCalls).toBe(2);
    expect(result.events.map((event) => event.type)).toEqual([
      "step_started", "step_done", "source_status", "ui_payload",
      "step_started", "step_done", "source_status", "ui_payload",
      "final",
    ]);
    const second = model.requests[1].input as { type?: string; call_id?: string; output?: string }[];
    expect(second.filter((item) => item.type === "function_call_output")).toEqual([
      { type: "function_call_output", call_id: "call_1_0", output: '{"pong":1}' },
      { type: "function_call_output", call_id: "call_1_1", output: '{"pong":2}' },
    ]);
    expect(db.actions.map((action) => action.status)).toEqual(["executed", "executed"]);
    expect(db.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.usage).toEqual({ input: 200, output: 20 });
  });

  it("sends the system prompt with the state as a delimited data block, plus recent turns", async () => {
    const { deps, model, store } = setup([{ text: "Hi!" }]);
    await store.addMessage("t0", "user", "earlier question");
    await store.addMessage("t0", "assistant", "earlier answer");
    await store.addMessage("t0", "system", "The user confirmed archive.");
    await runTurn("hello", deps);

    const request = model.requests[0];
    expect(request.instructions).toContain("You are Offer Desk");
    expect(request.instructions).toMatch(/<state>\n\{[^\n]*"today":"2026-11-10"[^\n]*"weekday":"Tuesday"[^\n]*\}\n<\/state>/);
    expect(request.input).toEqual([
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "developer", content: "App note: The user confirmed archive." },
      { role: "user", content: "hello" },
    ]);
    expect(request).toMatchObject({ store: false, tool_choice: "auto", include: ["reasoning.encrypted_content"] });
    expect((request.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["ping", "nuke"]);
  });

  it(`stops at ${MAX_TOOL_CALLS} tool calls per turn and makes the model answer`, async () => {
    const many = Array.from({ length: 4 }, () => ({ name: "ping", args: {} }));
    const { deps, model } = setup([{ calls: many }, { calls: many }, { text: "Stopped." }]);
    const result = await runTurn("go", deps);
    expect(runs).toBe(MAX_TOOL_CALLS);
    expect(result.final).toBe("Stopped.");
    expect(model.requests.at(-1)?.tool_choice).toBe("none");
    const refused = (model.requests[2].input as { type?: string; output?: string }[]).filter((item) => item.output?.includes("tool_limit"));
    expect(refused).toHaveLength(2);
  });

  it("holds a destructive action, forces a text answer, and makes sure the answer points to the dialog", async () => {
    const { deps, model, db } = setup([{ calls: [{ name: "nuke", args: {} }, { name: "ping", args: {} }] }, { text: "I nuked 3 things." }]);
    const result = await runTurn("nuke it", deps);

    expect(result.events.find((event) => event.type === "pending_action")).toMatchObject({ tool: "nuke", preview: { title: "Nuke 3 things?" } });
    expect(runs).toBe(0); // the second call in the same batch is not run once an action is pending
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1].tool_choice).toBe("none");
    expect(result.final).toContain("Nothing has changed yet: press Confirm");
    expect(db.actions[0].status).toBe("awaiting_confirmation");
  });

  it("gives each tool one fix attempt; a second failure ends tool use", async () => {
    const bad = { name: "ping", args: { n: "one" } };
    const { deps, model } = setup([{ calls: [bad] }, { calls: [bad] }, { calls: [bad], text: "Sorry, that failed." }]);
    const result = await runTurn("go", deps);
    expect(result.toolCalls).toBe(2);
    expect(model.requests).toHaveLength(3);
    expect(model.requests[2].tool_choice).toBe("none");
    expect(result.final).toBe("Sorry, that failed.");
  });

  it("answers without tools once the turn's tool deadline has passed", async () => {
    const { deps, model } = setup([{ calls: [{ name: "ping", args: {} }], text: "Out of time; here's what I have." }], { toolDeadline: Date.now() - 1 });
    const result = await runTurn("go", deps);
    expect(runs).toBe(0);
    expect(model.requests[0].tool_choice).toBe("none");
    expect(result.final).toBe("Out of time; here's what I have.");
  });

  it("reports a used-up AI limit as its own state, keeping what already ran", async () => {
    const { deps, db } = setup([{ calls: [{ name: "ping", args: {} }] }, new QuotaExceededError(500)]);
    const result = await runTurn("go", deps);
    expect(result.events).toContainEqual({ type: "error", code: "ai_limit", message: expect.stringContaining("Daily AI request limit") });
    expect(result.final).toContain("Done: pong.");
    expect(db.messages.at(-1)).toMatchObject({ role: "assistant", content: result.final });
  });

  it("reports an AI outage without crashing, and writes a code-made answer if the model gives none", async () => {
    const outage = setup([new Error("HTTP 503 from api.openai.com")]);
    const down = await runTurn("go", outage.deps);
    expect(down.events).toContainEqual({ type: "error", code: "ai_unavailable", message: "The AI service isn't responding right now." });
    expect(down.final).toContain("I couldn't complete that");

    const silent = setup([{ calls: [{ name: "ping", args: {} }] }, { text: "   " }]);
    expect((await runTurn("go", silent.deps)).final).toBe("Done: pong.");
  });
});

describe("buildState", () => {
  it("summarizes the session with clipped user fields and no posting text", async () => {
    const memory = memoryDb();
    const store = memory.storeFor("u1");
    await store.saveProfile({ name: "N".repeat(500), skills: Array.from({ length: 40 }, (_, i) => `skill${i}`), places: ["socal"], remoteOk: true, maxYears: 1, excludeClearanceEligible: false });
    const posting = memory.addPosting({ description: "SECRET-DESCRIPTION" });
    memory.addApplication("u1", posting.id, { stage: "applied" });
    await store.createResultSet({ id: "set1", ref: "S1", query: { query: "backend" }, postingIds: [posting.id], sourceStatus: null, breakdown: null });
    await store.insertRef("J1", "posting", posting.id);

    const state = await buildState(store, new Date("2026-11-10T20:00:00Z"), "America/Los_Angeles");
    expect(state).toMatchObject({
      today: "2026-11-10",
      weekday: "Tuesday",
      profile: { saved: true, max_years: 1 },
      pipeline: { total: 1, by_stage: { applied: 1, saved: 0 } },
      latest_results: { set: "S1", query: "backend", matches: 1, triaged: false, newest: [{ ref: "J1", company: "Acme" }] },
      pending_confirmations: [],
    });
    expect(state.profile.name!.length).toBeLessThanOrEqual(40);
    expect(state.profile.skills).toHaveLength(25);
    expect(JSON.stringify(state)).not.toContain("SECRET-DESCRIPTION");
  });

  it("shows the latest triage's top refs with scores, pending confirmations and recent files", async () => {
    const memory = memoryDb();
    const store = memory.storeFor("u1");
    const posting = memory.addPosting({ company: "Globex" });
    await store.createResultSet({ id: "set1", ref: "S1", query: { query: "backend" }, postingIds: [posting.id], sourceStatus: null, breakdown: null });
    await store.saveRanked("set1", { ranked: [{ postingId: posting.id, ref: "J1", score: { total: 77 } }], dropped: [], unread: [], notChecked: [] });
    await store.insertRef("J1", "posting", posting.id);
    const file = await store.createFile({ kind: "csv", filename: "jobs.csv", storagePath: "u1/x/jobs.csv", supersedesId: null });
    await store.insertRef("F1", "file", file.id);
    const id = await store.insertAction({ turnId: "t", tool: "archive_applications", destructive: true, args: {}, status: "proposed" });
    await store.updateAction(id, { status: "awaiting_confirmation", preview: { title: "Archive 2 applications?" }, expiresAt: "2026-11-10T20:10:00.000Z" });

    const state = await buildState(store, new Date("2026-11-10T20:00:00Z"), "America/Los_Angeles");
    expect(state.profile).toMatchObject({ saved: false, max_years: 2 });
    expect(state.latest_results).toMatchObject({ triaged: true, top_ranked: [{ ref: "J1", company: "Globex", score: 77 }] });
    expect(state.pending_confirmations).toEqual([{ action: "Archive 2 applications?", expires_in_minutes: 10 }]);
    expect(state.recent_files).toEqual([{ ref: "F1", filename: "jobs.csv" }]);
  });
});
