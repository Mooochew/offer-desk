import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// Plain fakes (TESTING.md "Known quirks"): record what the runtime passes to search and triage.
const seen: { search?: Record<string, unknown>; refresh?: unknown[]; triage?: Record<string, unknown> } = {};
let staleBoards: unknown[] = [];

vi.mock("@/lib/search/search-jobs", () => ({
  searchJobs: async (_criteria: unknown, deps: Record<string, unknown>) => {
    seen.search = deps;
    return { jobs: [], breakdown: {}, sources: [], failures: [], usedSnapshot: false, staleBoards };
  },
}));
vi.mock("@/lib/search/board-cache", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBoards: async (boards: unknown[]) => {
    seen.refresh = boards;
    return [];
  },
}));
vi.mock("@/lib/triage/triage", () => ({
  triageJobs: async (_jobs: unknown, _profile: unknown, _filters: unknown, deps: Record<string, unknown>) => {
    seen.triage = deps;
    return {};
  },
}));

const { callerFor, counterFor, createServices, createToolContext, createTurnDeps, TOOLS_MS, WORK_MS } = await import("@/lib/agent/runtime");

function fakeAdmin(reply: { data?: unknown; error?: { message: string } | null } = { data: 1 }) {
  return { rpc: async () => ({ data: null, error: null, ...reply }), from: () => ({}) } as unknown as SupabaseClient;
}

describe("agent runtime wiring", () => {
  it("searches with stale-while-revalidate and a deadline-bound budget, then refreshes stale boards after the response", async () => {
    staleBoards = [{ name: "Acme", ats: "greenhouse", slug: "acme", tags: [] }];
    const tasks: (() => Promise<void>)[] = [];
    const services = createServices(fakeAdmin(), callerFor("u1", "1.2.3.4"), (task) => tasks.push(task));
    await services.search({ query: "backend" }, Date.now() + WORK_MS);

    expect(seen.search).toMatchObject({ serveStale: true });
    expect(seen.search!.budgetMs).toBeLessThanOrEqual(15_000);
    expect(seen.search!.budgetMs).toBeGreaterThanOrEqual(2_000);
    expect(tasks).toHaveLength(1);
    await tasks[0]();
    expect(seen.refresh).toEqual(staleBoards);
  });

  it("doesn't schedule a refresh when nothing was stale, and keeps a minimum budget near the deadline", async () => {
    staleBoards = [];
    const tasks: unknown[] = [];
    await createServices(fakeAdmin(), callerFor("u1", "1.2.3.4"), (task) => tasks.push(task)).search({ query: "x" }, Date.now());
    expect(tasks).toEqual([]);
    expect(seen.search!.budgetMs).toBe(2_000);
  });

  it("passes the turn deadline and the caller's extraction budget into triage", async () => {
    const deadline = Date.now() + 1234;
    await createServices(fakeAdmin(), callerFor("u1", "1.2.3.4"), () => undefined).triage([], { name: null, skills: [], places: [], remoteOk: true, maxYears: 2 }, { maxYears: 2, excludeActiveClearance: true, excludeClearanceEligible: false }, deadline);
    expect(seen.triage).toMatchObject({ deadline, model: "gpt-6-luna" });
    expect(seen.triage!.create).toBeTypeOf("function");
  });

  it("builds a context with a validated timezone and the work deadline", () => {
    const base = { admin: fakeAdmin(), user: fakeAdmin(), userId: "u1", ip: "1.2.3.4", background: () => undefined, startedAt: 1_000 };
    expect(createToolContext({ ...base, timezone: "Asia/Tokyo" })).toMatchObject({ timezone: "Asia/Tokyo", deadline: 1_000 + WORK_MS });
    expect(createToolContext({ ...base, timezone: "Not/AZone" }).timezone).toBe("America/Los_Angeles");
    const ctx = createToolContext(base);
    expect(ctx.store.userId).toBe("u1");
    expect(createTurnDeps(ctx, fakeAdmin(), 1_000)).toMatchObject({ toolDeadline: 1_000 + TOOLS_MS, model: "gpt-6-luna", prompt: { version: "system-v3" } });
  });

  it("counts with the atomic counter and fails closed on counter errors", async () => {
    await expect(counterFor(fakeAdmin({ data: 3 }))("k", 60)).resolves.toBe(3);
    await expect(counterFor(fakeAdmin({ error: { message: "db down" } }))("k", 60)).rejects.toThrow("counter failed: db down");
  });

  it("hashes the caller's IP with the server secret", () => {
    const caller = callerFor("u1", "1.2.3.4");
    expect(caller.userId).toBe("u1");
    expect(caller.ipHash).toMatch(/^[a-f0-9]{32}$/);
  });
});
