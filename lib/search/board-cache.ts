import { isEngineeringTitle } from "@/lib/sources/normalize";
import { boardKey, type Board, type BoardJob, type NormalizedJob } from "@/lib/sources/types";
import { mapWithConcurrency } from "@/lib/util/concurrency";

export type CacheEntry = {
  jobs: BoardJob[];
  status: "ok" | "error";
  error: string | null;
  fetchedAt: string;
  expiresAt: string;
};

/** Storage the cache needs. Supabase in production (supabase-store.ts), in-memory in tests. */
export interface BoardStore {
  getEntries(keys: string[]): Promise<Map<string, CacheEntry>>;
  saveEntry(key: string, entry: CacheEntry): Promise<void>;
  /** Saves jobs to `postings` and returns each job's posting id, keyed by `${source}:${sourceId}`. */
  upsertPostings(board: Board, jobs: NormalizedJob[]): Promise<Map<string, string>>;
}

/** How each board's jobs were obtained for this search. */
export type BoardOutcome =
  | "cached" // fresh cache hit
  | "refreshed" // fetched live just now
  | "stale" // refresh failed or skipped; older cached jobs used
  | "failed" // refresh failed and nothing cached
  | "skipped"; // over the refresh budget and nothing cached

export type BoardResult = { board: Board; outcome: BoardOutcome; jobs: BoardJob[]; error?: string };

export type RefreshOptions = {
  store: BoardStore;
  fetchBoard: (board: Board) => Promise<NormalizedJob[]>;
  now?: () => number;
  ttlMs?: number;
  /** After a failed fetch, wait this long before trying the board again. */
  errorTtlMs?: number;
  concurrency?: number;
  /** At most this many boards are fetched live per search. */
  maxRefreshes?: number;
  /** Stop starting new fetches after this many ms. */
  budgetMs?: number;
};

const HOUR_MS = 60 * 60 * 1000;

export function jobKey(job: Pick<NormalizedJob, "source" | "sourceId">): string {
  return `${job.source}:${job.sourceId}`;
}

/** The cached form of a job: everything except the description and raw source fields. */
export function toBoardJob(job: NormalizedJob, postingId: string): BoardJob {
  return {
    postingId,
    source: job.source,
    sourceId: job.sourceId,
    company: job.company,
    title: job.title,
    location: job.location,
    locations: job.locations,
    remote: job.remote,
    url: job.url,
    postedAt: job.postedAt,
    employmentType: job.employmentType,
  };
}

/** Fetches a board, keeps engineering jobs, stores them, and returns the light cache entry. */
async function refreshBoard(board: Board, options: Required<RefreshOptions>): Promise<CacheEntry> {
  const jobs = (await options.fetchBoard(board)).filter((job) => isEngineeringTitle(job.title));
  const ids = await options.store.upsertPostings(board, jobs);

  const lightJobs: BoardJob[] = jobs.flatMap((job) => {
    const postingId = ids.get(jobKey(job));
    return postingId ? [toBoardJob(job, postingId)] : [];
  });

  const now = options.now();
  return {
    jobs: lightJobs,
    status: "ok",
    error: null,
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + options.ttlMs).toISOString(),
  };
}

/**
 * Returns jobs for each board: fresh cache when possible, otherwise a live fetch within the
 * refresh budget, otherwise stale cached jobs. Never throws for a single board's failure.
 */
export async function loadBoards(boards: readonly Board[], input: RefreshOptions): Promise<BoardResult[]> {
  const options: Required<RefreshOptions> = {
    now: Date.now,
    ttlMs: 6 * HOUR_MS,
    errorTtlMs: 10 * 60 * 1000,
    concurrency: 8,
    // Matches the 60-board selection, so a cold search fetches every selected board; the time
    // budget below is what protects the Vercel function limit.
    maxRefreshes: 60,
    budgetMs: 25_000,
    ...input,
  };
  const started = options.now();
  const entries = await options.store.getEntries(boards.map(boardKey));
  let refreshesStarted = 0;

  const settled = await mapWithConcurrency(boards, options.concurrency, async (board): Promise<BoardResult> => {
    const key = boardKey(board);
    const cached = entries.get(key);
    const isFresh = cached && Date.parse(cached.expiresAt) > options.now();
    if (cached && isFresh) {
      return cached.status === "ok"
        ? { board, outcome: "cached", jobs: cached.jobs }
        : { board, outcome: cached.jobs.length ? "stale" : "failed", jobs: cached.jobs, error: cached.error ?? undefined };
    }

    const overBudget = refreshesStarted >= options.maxRefreshes || options.now() - started > options.budgetMs;
    if (overBudget) {
      return cached?.jobs.length ? { board, outcome: "stale", jobs: cached.jobs } : { board, outcome: "skipped", jobs: [] };
    }

    refreshesStarted++;
    try {
      const entry = await refreshBoard(board, options);
      await options.store.saveEntry(key, entry);
      return { board, outcome: "refreshed", jobs: entry.jobs };
    } catch (error) {
      const message = (error as Error).message;
      const now = options.now();
      // Keep any older jobs, but don't retry this board for a while.
      await options.store.saveEntry(key, {
        jobs: cached?.jobs ?? [],
        status: "error",
        error: message,
        fetchedAt: cached?.fetchedAt ?? new Date(now).toISOString(),
        expiresAt: new Date(now + options.errorTtlMs).toISOString(),
      });
      return cached?.jobs.length
        ? { board, outcome: "stale", jobs: cached.jobs, error: message }
        : { board, outcome: "failed", jobs: [], error: message };
    }
  });

  return settled.map((result, index) =>
    result.ok ? result.value : { board: boards[index], outcome: "failed", jobs: [], error: String(result.error) },
  );
}
