import type { BoardStore, CacheEntry } from "@/lib/search/board-cache";
import type { BoardJob, NormalizedJob, SourceName } from "@/lib/sources/types";

/** Builds a BoardJob with sensible defaults for filter tests. */
export function boardJob(overrides: Partial<BoardJob> = {}): BoardJob {
  return {
    postingId: overrides.postingId ?? crypto.randomUUID(),
    source: "greenhouse",
    sourceId: crypto.randomUUID(),
    company: "Acme",
    title: "Software Engineer",
    location: "Remote (US)",
    locations: ["Remote (US)"],
    remote: "remote",
    url: "https://example.com/job",
    postedAt: "2026-11-08T00:00:00.000Z",
    employmentType: null,
    ...overrides,
  };
}

/** Builds a NormalizedJob, as a source fetcher would return it. */
export function normalizedJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: "greenhouse" as SourceName,
    sourceId: crypto.randomUUID(),
    company: "Acme",
    title: "Software Engineer",
    location: "Remote (US)",
    locations: ["Remote (US)"],
    remote: "remote",
    url: "https://example.com/job",
    postedAt: "2026-11-08T00:00:00.000Z",
    employmentType: null,
    description: "We build things.",
    raw: {},
    ...overrides,
  };
}

/** In-memory BoardStore that records what was written. */
export function memoryStore(initial: Record<string, CacheEntry> = {}) {
  const entries = new Map(Object.entries(initial));
  const savedPostings: NormalizedJob[] = [];
  const store: BoardStore = {
    async getEntries(keys) {
      return new Map(keys.flatMap((key) => (entries.has(key) ? [[key, entries.get(key)!] as const] : [])));
    },
    async saveEntry(key, entry) {
      entries.set(key, entry);
    },
    async upsertPostings(_board, jobs) {
      for (const job of jobs) {
        const index = savedPostings.findIndex((saved) => saved.source === job.source && saved.sourceId === job.sourceId);
        if (index >= 0) savedPostings[index] = job;
        else savedPostings.push(job);
      }
      return new Map(jobs.map((job) => [`${job.source}:${job.sourceId}`, `posting-${job.sourceId}`]));
    },
    async insertMissingPostings(_board, jobs) {
      for (const job of jobs) {
        const exists = savedPostings.some((saved) => saved.source === job.source && saved.sourceId === job.sourceId);
        if (!exists) savedPostings.push(job);
      }
      return new Map(jobs.map((job) => [`${job.source}:${job.sourceId}`, `posting-${job.sourceId}`]));
    },
  };
  return { store, entries, savedPostings };
}
