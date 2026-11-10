import { describe, expect, it } from "vitest";
import { loadDescriptions, type DescriptionStore, type PostingForDescription } from "@/lib/search/descriptions";
import { searchJobs, summarizeSources } from "@/lib/search/search-jobs";
import type { Board } from "@/lib/sources/types";
import { boardJob, memoryStore, normalizedJob } from "./fakes";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const boards: Board[] = [
  { name: "Acme", ats: "greenhouse", slug: "acme", tags: [] },
  { name: "Beta", ats: "ashby", slug: "beta", tags: ["socal"] },
];

describe("searchJobs", () => {
  it("loads selected boards, filters, and reports per-source status", async () => {
    const { store } = memoryStore();
    const result = await searchJobs(
      { query: "backend", places: [], remoteOk: true },
      {
        boards,
        store,
        now: () => NOW,
        fetchBoard: async (board) => [
          normalizedJob({ company: board.name, title: "Backend Engineer", postedAt: "2026-11-09T00:00:00Z" }),
          normalizedJob({ company: board.name, title: "Senior Backend Engineer" }),
        ],
      },
    );

    expect(result.jobs.map((job) => job.company).sort()).toEqual(["Acme", "Beta"]);
    expect(result.breakdown).toMatchObject({ considered: 4, droppedSeniority: 2, remaining: 2 });
    const bySource = [...result.sources].sort((a, b) => a.source.localeCompare(b.source));
    expect(bySource).toEqual([
      { source: "ashby", boards: 1, jobs: 2, cached: 0, refreshed: 1, stale: 0, failed: 0, skipped: 0 },
      { source: "greenhouse", boards: 1, jobs: 2, cached: 0, refreshed: 1, stale: 0, failed: 0, skipped: 0 },
    ]);
    expect(result.usedSnapshot).toBe(false);
  });

  it("selects tag-matching boards first (SoCal search puts Beta first)", async () => {
    const order: string[] = [];
    await searchJobs(
      { query: "", places: ["Los Angeles"] },
      { boards, store: memoryStore().store, now: () => NOW, concurrency: 1, fetchBoard: async (board) => (order.push(board.slug), []) },
    );
    expect(order).toEqual(["beta", "acme"]);
  });

  it("falls back to the snapshot when every board fails, and says so", async () => {
    const snapshotJob = boardJob({ title: "Snapshot Software Engineer" });
    const result = await searchJobs(
      { query: "" },
      {
        boards,
        store: memoryStore().store,
        now: () => NOW,
        fetchBoard: async () => {
          throw new Error("network down");
        },
        loadSnapshot: async () => [snapshotJob],
      },
    );
    expect(result.usedSnapshot).toBe(true);
    expect(result.jobs.map((job) => job.title)).toEqual(["Snapshot Software Engineer"]);
    expect(result.failures).toEqual([
      { board: "Acme", error: "network down" },
      { board: "Beta", error: "network down" },
    ]);
  });

  it("does not use the snapshot when live boards returned jobs", async () => {
    let snapshotCalls = 0;
    const result = await searchJobs(
      { query: "" },
      {
        boards,
        store: memoryStore().store,
        now: () => NOW,
        fetchBoard: async () => [normalizedJob()],
        loadSnapshot: async () => (snapshotCalls++, []),
      },
    );
    expect(result.usedSnapshot).toBe(false);
    expect(snapshotCalls).toBe(0);
  });
});

describe("summarizeSources", () => {
  it("counts outcomes per source", () => {
    const [status] = summarizeSources([
      { board: boards[0], outcome: "cached", jobs: [boardJob()] },
      { board: boards[0], outcome: "failed", jobs: [], error: "x" },
    ]);
    expect(status).toMatchObject({ source: "greenhouse", boards: 2, jobs: 1, cached: 1, failed: 1 });
  });
});

describe("loadDescriptions", () => {
  function store(postings: PostingForDescription[]) {
    const saved = new Map<string, string>();
    const descriptionStore: DescriptionStore = {
      getPostings: async (ids) => postings.filter((posting) => ids.includes(posting.id)),
      saveDescription: async (id, text) => void saved.set(id, text),
    };
    return { descriptionStore, saved };
  }

  it("uses stored descriptions and fetches missing Greenhouse ones once, saving them", async () => {
    const { descriptionStore, saved } = store([
      { id: "p1", source: "ashby", sourceId: "a", description: "Stored text", boardSlug: "beta" },
      { id: "p2", source: "greenhouse", sourceId: "42", description: null, boardSlug: "acme" },
    ]);
    const requested: string[] = [];
    const result = await loadDescriptions(["p1", "p2"], {
      store: descriptionStore,
      fetchGreenhouse: async (slug, jobId) => (requested.push(`${slug}/${jobId}`), "Fetched text"),
    });

    expect(result.get("p1")).toBe("Stored text");
    expect(result.get("p2")).toBe("Fetched text");
    expect(requested).toEqual(["acme/42"]);
    expect(saved.get("p2")).toBe("Fetched text");
  });

  it("returns null for postings it can't load, without failing the others", async () => {
    const { descriptionStore } = store([
      { id: "p1", source: "greenhouse", sourceId: "1", description: null, boardSlug: "acme" },
      { id: "p2", source: "lever", sourceId: "2", description: null, boardSlug: "x" },
      { id: "p3", source: "greenhouse", sourceId: "3", description: null, boardSlug: "acme" },
    ]);
    const result = await loadDescriptions(["p1", "p2", "p3", "missing"], {
      store: descriptionStore,
      fetchGreenhouse: async (_slug, jobId) => {
        if (jobId === "1") throw new Error("HTTP 500");
        return "ok";
      },
    });
    expect(result.get("p1")).toBeNull(); // fetch failed
    expect(result.get("p2")).toBeNull(); // not Greenhouse, nothing to fetch
    expect(result.get("p3")).toBe("ok");
    expect(result.get("missing")).toBeNull();
  });
});
