import type { Profile } from "@/lib/profile/types";
import type { BoardJob } from "@/lib/sources/types";
import type { ExtractDeps } from "./extract";
import { extractMany, type ExtractionStore } from "./extraction-cache";
import { requirementDropReason, type DropReason, type RequirementFilters } from "./filter";
import { preRank } from "./prerank";
import type { Extraction } from "./schema";
import { scoreJob, type JobScore } from "./score";
import { whyMatched } from "./why";

export const DEFAULT_MAX_EXTRACT = 25;

export type TriagedJob = { job: BoardJob; extraction: Extraction; score: JobScore; why: string };
export type DroppedJob = { job: BoardJob; extraction: Extraction; reason: DropReason; evidence: string | null };
/** Postings whose requirements couldn't be read: kept visible, never silently dropped. */
export type UnreadJob = { job: BoardJob; reason: "no description" | "extraction failed" | "AI unavailable"; detail: string | null };

/** Counts for the UI ("… → 25 checked → 12 left"), continuing the search breakdown. */
export type TriageBreakdown = {
  candidates: number;
  checked: number;
  notChecked: number;
  unread: number;
  droppedYears: number;
  droppedClearance: number;
  remaining: number;
};

export type TriageResult = {
  ranked: TriagedJob[];
  dropped: DroppedJob[];
  unread: UnreadJob[];
  breakdown: TriageBreakdown;
  cacheHits: number;
  modelCalls: number;
};

export type TriageDeps = ExtractDeps & {
  store: ExtractionStore;
  /** Loads full descriptions by posting id (lib/search/descriptions.ts in production). */
  loadDescriptions: (postingIds: string[]) => Promise<Map<string, string | null>>;
  maxExtract?: number;
  concurrency?: number;
  now?: () => Date;
};

/**
 * Turns search results into a ranked shortlist: pick the most promising postings (code pre-rank),
 * have the LLM extract their requirements (cached), drop the ones that fail hard requirements,
 * and score the rest. Only extraction uses the LLM; every decision and number is code.
 */
export async function triageJobs(jobs: readonly BoardJob[], profile: Profile, filters: RequirementFilters, deps: TriageDeps): Promise<TriageResult> {
  const now = deps.now?.() ?? new Date();
  const chosen = preRank(jobs, profile, deps.maxExtract ?? DEFAULT_MAX_EXTRACT, now);
  const descriptions = await deps.loadDescriptions(chosen.map((job) => job.postingId));

  const unread: UnreadJob[] = [];
  const readable = chosen.filter((job) => {
    if (descriptions.get(job.postingId)) return true;
    unread.push({ job, reason: "no description", detail: null });
    return false;
  });

  const extracted = await extractMany(
    readable.map((job) => ({
      id: job.postingId,
      text: { title: job.title, company: job.company, locations: job.locations, description: descriptions.get(job.postingId)! },
    })),
    deps,
  );
  for (const { id, error } of extracted.apiErrors) {
    unread.push({ job: readable.find((job) => job.postingId === id)!, reason: "AI unavailable", detail: error });
  }

  const ranked: TriagedJob[] = [];
  const dropped: DroppedJob[] = [];
  for (const job of readable) {
    const result = extracted.results.get(job.postingId);
    if (!result) continue; // API error, already in unread
    if (result.status === "failed" || !result.extraction) {
      unread.push({ job, reason: "extraction failed", detail: result.error });
      continue;
    }
    const extraction = result.extraction;
    const reason = requirementDropReason(extraction, filters);
    if (reason) {
      dropped.push({ job, extraction, reason, evidence: reason === "years" ? extraction.evidence.years : extraction.evidence.clearance });
      continue;
    }
    const score = scoreJob(job, extraction, profile, now);
    ranked.push({ job, extraction, score, why: whyMatched(extraction, score) });
  }

  ranked.sort((a, b) => b.score.total - a.score.total);

  return {
    ranked,
    dropped,
    unread,
    breakdown: {
      candidates: jobs.length,
      checked: chosen.length,
      notChecked: jobs.length - chosen.length,
      unread: unread.length,
      droppedYears: dropped.filter((item) => item.reason === "years").length,
      droppedClearance: dropped.filter((item) => item.reason === "clearance").length,
      remaining: ranked.length,
    },
    cacheHits: extracted.cacheHits,
    modelCalls: extracted.modelCalls,
  };
}
