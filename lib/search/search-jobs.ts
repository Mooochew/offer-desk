import { ALL_BOARDS, selectBoards, tagsFor } from "@/lib/sources/boards";
import type { Board, BoardJob, SourceName } from "@/lib/sources/types";
import { loadBoards, type BoardOutcome, type BoardResult, type RefreshOptions } from "./board-cache";
import { filterJobs, type Breakdown, type SearchCriteria } from "./filter";

/** Per-source summary for the UI chips, e.g. "Greenhouse: 12 boards, 2 timed out". */
export type SourceStatus = {
  source: SourceName;
  boards: number;
  jobs: number;
} & Record<BoardOutcome, number>;

export type SearchResult = {
  jobs: BoardJob[];
  breakdown: Breakdown;
  sources: SourceStatus[];
  /** Boards whose fetch failed, with the error, for the action log. */
  failures: { board: string; error: string }[];
  /** True when every live source failed and the bundled snapshot was used instead. */
  usedSnapshot: boolean;
  /** Boards served from an expired cache (with `serveStale`); refresh them after responding. */
  staleBoards: Board[];
};

export type SearchDeps = Omit<RefreshOptions, "now"> & {
  boards?: readonly Board[];
  maxBoards?: number;
  now?: () => number;
  /** Jobs to fall back on when no live board returned anything. */
  loadSnapshot?: () => Promise<BoardJob[]>;
};

export function summarizeSources(results: BoardResult[]): SourceStatus[] {
  const bySource = new Map<SourceName, SourceStatus>();
  for (const { board, outcome, jobs } of results) {
    const status =
      bySource.get(board.ats) ??
      { source: board.ats, boards: 0, jobs: 0, cached: 0, refreshed: 0, stale: 0, failed: 0, skipped: 0 };
    status.boards++;
    status.jobs += jobs.length;
    status[outcome]++;
    bySource.set(board.ats, status);
  }
  return [...bySource.values()];
}

/**
 * Searches company job boards: picks boards for the query, loads them (cache first), and runs
 * the code-side prefilter. The LLM supplies `criteria`; everything here is deterministic.
 */
export async function searchJobs(criteria: SearchCriteria, deps: SearchDeps): Promise<SearchResult> {
  const now = deps.now ?? Date.now;
  const boards = selectBoards(deps.boards ?? ALL_BOARDS, tagsFor(criteria.query, criteria.places ?? []), deps.maxBoards ?? 60);
  const results = await loadBoards(boards, { ...deps, now });

  let allJobs = results.flatMap((result) => result.jobs);
  let usedSnapshot = false;
  if (allJobs.length === 0 && deps.loadSnapshot) {
    allJobs = await deps.loadSnapshot();
    usedSnapshot = allJobs.length > 0;
  }

  const { jobs, breakdown } = filterJobs(allJobs, criteria, new Date(now()));
  return {
    jobs,
    breakdown,
    sources: summarizeSources(results),
    failures: results.filter((result) => result.error).map((result) => ({ board: result.board.name, error: result.error! })),
    usedSnapshot,
    staleBoards: results.filter((result) => result.needsRefresh).map((result) => result.board),
  };
}
