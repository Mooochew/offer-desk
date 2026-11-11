import { describe, expect, it } from "vitest";
import { loadBoards, type CacheEntry } from "@/lib/search/board-cache";
import type { Board, NormalizedJob } from "@/lib/sources/types";
import { boardJob, memoryStore, normalizedJob } from "./fakes";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const board = (slug: string): Board => ({ name: slug, ats: "greenhouse", slug, tags: [] });

function entry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return {
    jobs: [boardJob({ title: "Cached Software Engineer" })],
    status: "ok",
    error: null,
    fetchedAt: new Date(NOW - HOUR).toISOString(),
    expiresAt: new Date(NOW + HOUR).toISOString(),
    ...overrides,
  };
}

/** A fetcher that returns `jobs` (or throws `error`) and counts calls per board. */
function fetcher(jobs: NormalizedJob[] = [normalizedJob()], error?: Error) {
  const calls: string[] = [];
  return {
    calls,
    fetchBoard: async (b: Board) => {
      calls.push(b.slug);
      if (error) throw error;
      return jobs;
    },
  };
}

const base = { now: () => NOW };

describe("loadBoards", () => {
  it("serves a fresh cache entry without fetching", async () => {
    const { store } = memoryStore({ "greenhouse:a": entry() });
    const live = fetcher();
    const [result] = await loadBoards([board("a")], { ...base, store, fetchBoard: live.fetchBoard });
    expect(result.outcome).toBe("cached");
    expect(result.jobs[0].title).toBe("Cached Software Engineer");
    expect(live.calls).toEqual([]);
  });

  // DECISIONS 031: graders arrive days after the cache was warmed; don't make them wait for it.
  it("with serveStale, serves an expired entry at once and marks it for a later refresh", async () => {
    const expired = entry({ expiresAt: new Date(NOW - HOUR).toISOString() });
    const { store } = memoryStore({ "greenhouse:a": expired, "greenhouse:b": entry({ expiresAt: new Date(NOW - HOUR).toISOString(), status: "error", jobs: [] }) });
    const live = fetcher();
    const [stale, failedBefore] = await loadBoards([board("a"), board("b")], { ...base, store, fetchBoard: live.fetchBoard, serveStale: true });
    expect(stale).toMatchObject({ outcome: "stale", needsRefresh: true, jobs: expired.jobs });
    // An entry with nothing to serve is still refreshed inline.
    expect(failedBefore.outcome).toBe("refreshed");
    expect(live.calls).toEqual(["b"]);
  });

  it("refreshes an expired entry, keeps only engineering jobs, and stores them", async () => {
    const { store, entries, savedPostings } = memoryStore({ "greenhouse:a": entry({ expiresAt: new Date(NOW - 1).toISOString() }) });
    const live = fetcher([normalizedJob({ title: "Backend Engineer" }), normalizedJob({ title: "Account Executive" })]);

    const [result] = await loadBoards([board("a")], { ...base, store, fetchBoard: live.fetchBoard });

    expect(result.outcome).toBe("refreshed");
    expect(result.jobs.map((job) => job.title)).toEqual(["Backend Engineer"]);
    expect(savedPostings.map((job) => job.title)).toEqual(["Backend Engineer"]);
    // The cache holds light entries: posting id, no description.
    expect(result.jobs[0].postingId).toMatch(/^posting-/);
    expect(result.jobs[0]).not.toHaveProperty("description");
    expect(entries.get("greenhouse:a")?.expiresAt).toBe(new Date(NOW + 6 * HOUR).toISOString());
  });

  it("falls back to stale jobs when a refresh fails, and records the error", async () => {
    const { store, entries } = memoryStore({ "greenhouse:a": entry({ expiresAt: new Date(NOW - 1).toISOString() }) });
    const live = fetcher([], new Error("HTTP 503"));

    const [result] = await loadBoards([board("a")], { ...base, store, fetchBoard: live.fetchBoard });

    expect(result.outcome).toBe("stale");
    expect(result.error).toBe("HTTP 503");
    expect(result.jobs[0].title).toBe("Cached Software Engineer");
    expect(entries.get("greenhouse:a")).toMatchObject({ status: "error", error: "HTTP 503" });
    expect(entries.get("greenhouse:a")?.jobs).toHaveLength(1);
  });

  it("reports failed when a refresh fails and nothing was cached", async () => {
    const { store } = memoryStore();
    const [result] = await loadBoards([board("a")], { ...base, store, fetchBoard: fetcher([], new Error("HTTP 404")).fetchBoard });
    expect(result).toMatchObject({ outcome: "failed", jobs: [], error: "HTTP 404" });
  });

  it("doesn't retry a recently failed board until its error entry expires", async () => {
    const { store } = memoryStore({ "greenhouse:a": entry({ status: "error", error: "HTTP 503", jobs: [] }) });
    const live = fetcher();
    const [result] = await loadBoards([board("a")], { ...base, store, fetchBoard: live.fetchBoard });
    expect(result.outcome).toBe("failed");
    expect(live.calls).toEqual([]);
  });

  it("stops fetching after the refresh limit and serves stale or skips the rest", async () => {
    const { store } = memoryStore({ "greenhouse:c": entry({ expiresAt: new Date(NOW - 1).toISOString() }) });
    const live = fetcher();
    const results = await loadBoards([board("a"), board("b"), board("c"), board("d")], {
      ...base,
      store,
      fetchBoard: live.fetchBoard,
      maxRefreshes: 2,
      concurrency: 1,
    });
    expect(results.map((result) => result.outcome)).toEqual(["refreshed", "refreshed", "stale", "skipped"]);
    expect(live.calls).toEqual(["a", "b"]);
  });

  it("stops starting new fetches once the time budget is spent", async () => {
    const { store } = memoryStore();
    let clock = NOW;
    const results = await loadBoards([board("a"), board("b")], {
      store,
      now: () => clock,
      budgetMs: 1000,
      concurrency: 1,
      fetchBoard: async () => {
        clock += 5000; // this fetch blows the budget
        return [normalizedJob()];
      },
    });
    expect(results.map((result) => result.outcome)).toEqual(["refreshed", "skipped"]);
  });
});
