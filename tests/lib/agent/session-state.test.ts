import { describe, expect, it } from "vitest";
import { executeToolCall } from "@/lib/agent/executor";
import { loadSessionState } from "@/lib/agent/session-state";
import { createRegistry } from "@/lib/agent/tools/registry";
import { extraction } from "../triage/fakes";
import { boardJobFrom, emptySearch, emptyTriage, memoryDb, toolContext } from "./memory-store";

const NOW = new Date("2026-11-10T20:00:00Z");
const registry = createRegistry();

describe("loadSessionState", () => {
  it("is empty for a new session", async () => {
    const state = await loadSessionState(memoryDb().storeFor("u1"), NOW);
    expect(state).toEqual({ profile: null, pipeline: [], files: [], actions: [], messages: [], results: null });
  });

  it("returns the pipeline with postings, the triaged results with evidence, files, the log and chat, for this user only", async () => {
    const memory = memoryDb(() => NOW);
    const postings = [memory.addPosting({ company: "Acme" }), memory.addPosting({ company: "Globex" })];
    const store = memory.storeFor("u1");
    const triage = emptyTriage();
    triage.ranked = [{ job: boardJobFrom(postings[0]), extraction: extraction(), score: { total: 70 } as never, why: "Matches Go" }];
    triage.dropped = [{ job: boardJobFrom(postings[1]), extraction: extraction({ years_required_min: 5 }), reason: "years", evidence: "5+ years" }];
    const ctx = toolContext(store, { now: () => NOW, services: { search: async () => emptySearch(postings.map(boardJobFrom)), triage: async () => triage } });
    await executeToolCall(registry, "search_jobs", JSON.stringify({ query: "backend" }), ctx);
    await executeToolCall(registry, "triage_results", "{}", ctx);
    await executeToolCall(registry, "save_to_pipeline", JSON.stringify({ refs: ["J1"] }), ctx);
    await executeToolCall(registry, "export_csv", "{}", ctx);
    await store.addMessage("t", "user", "find jobs");
    await store.addMessage("t", "system", "internal note");
    memory.addApplication("someone-else", postings[1].id);

    const state = await loadSessionState(store, NOW);
    expect(state.pipeline).toMatchObject([{ ref: "A1", application: { stage: "saved" }, posting: { company: "Acme" } }]);
    expect(state.results).toMatchObject({ set: "S1", triaged: true, ranked: [{ ref: "J1", why: "Matches Go" }], dropped: [{ ref: "J2", evidence: "5+ years" }], jobs: [] });
    expect(state.files).toMatchObject([{ ref: "F1", kind: "csv" }]);
    expect(state.actions.map((action) => action.tool)).toEqual(["export_csv", "save_to_pipeline", "triage_results", "search_jobs"]);
    expect(state.messages).toEqual([{ role: "user", content: "find jobs", createdAt: expect.any(String) }]);
  });

  it("shows untriaged search results with their refs, and expires stale proposals", async () => {
    const memory = memoryDb(() => NOW);
    const store = memory.storeFor("u1");
    const postings = [memory.addPosting(), memory.addPosting()];
    const ctx = toolContext(store, { now: () => NOW, services: { search: async () => emptySearch(postings.map(boardJobFrom)) } });
    await executeToolCall(registry, "search_jobs", JSON.stringify({ query: "backend" }), ctx);
    const id = await store.insertAction({ turnId: "t", tool: "archive_applications", destructive: true, args: {}, status: "proposed" });
    await store.updateAction(id, { status: "awaiting_confirmation", expiresAt: "2026-11-10T19:00:00.000Z" });

    const state = await loadSessionState(store, NOW);
    expect(state.results).toMatchObject({ triaged: false, jobs: [{ ref: "J1" }, { ref: "J2" }] });
    // The source chips survive a reload (review N1).
    expect(state.results?.sourceStatus).toMatchObject({ sources: expect.any(Array), usedSnapshot: false });
    expect(state.actions.find((action) => action.id === id)?.status).toBe("expired");
  });
});
