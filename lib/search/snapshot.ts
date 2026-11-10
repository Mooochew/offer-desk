import { z } from "zod";
import type { Board, BoardJob, NormalizedJob } from "@/lib/sources/types";
import { jobKey, toBoardJob, type BoardStore } from "./board-cache";

// One saved posting from data/sample_postings.json (made by scripts/snapshot-postings.mts).
const snapshotJobSchema = z.object({
  boardName: z.string(),
  boardSlug: z.string(),
  source: z.enum(["greenhouse", "lever", "ashby"]),
  sourceId: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  locations: z.array(z.string()),
  remote: z.enum(["onsite", "hybrid", "remote", "unknown"]),
  url: z.string(),
  postedAt: z.string().nullable(),
  employmentType: z.string().nullable(),
  description: z.string().nullable(),
});

export type SnapshotJob = z.infer<typeof snapshotJobSchema>;

export const snapshotSchema = z.object({
  takenAt: z.string(),
  jobs: z.array(snapshotJobSchema),
});

/**
 * Loads saved real postings into the store and returns them as cached jobs. Used when every live
 * board fails (search fallback) and to seed the demo pipeline. Jobs keep their original source
 * ids, so they line up with live data rather than duplicating it.
 */
export async function loadSnapshotJobs(rawSnapshot: unknown, store: Pick<BoardStore, "upsertPostings">): Promise<BoardJob[]> {
  const snapshot = snapshotSchema.parse(rawSnapshot);
  const byBoard = new Map<string, { board: Board; jobs: NormalizedJob[] }>();

  for (const saved of snapshot.jobs) {
    const key = `${saved.source}:${saved.boardSlug}`;
    const group = byBoard.get(key) ?? {
      board: { name: saved.boardName, ats: saved.source, slug: saved.boardSlug, tags: [] },
      jobs: [],
    };
    group.jobs.push({
      source: saved.source,
      sourceId: saved.sourceId,
      company: saved.company,
      title: saved.title,
      location: saved.location,
      locations: saved.locations,
      remote: saved.remote,
      url: saved.url,
      postedAt: saved.postedAt,
      employmentType: saved.employmentType,
      description: saved.description,
      raw: { fromSnapshot: snapshot.takenAt },
    });
    byBoard.set(key, group);
  }

  const result: BoardJob[] = [];
  for (const { board, jobs } of byBoard.values()) {
    const ids = await store.upsertPostings(board, jobs);
    for (const job of jobs) {
      const postingId = ids.get(jobKey(job));
      if (postingId) result.push(toBoardJob(job, postingId));
    }
  }
  return result;
}
