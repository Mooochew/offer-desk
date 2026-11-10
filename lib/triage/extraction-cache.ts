import { descriptionHash } from "@/lib/sources/normalize";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { EXTRACTION_CHECK_VERSION, groundingProblems, type Extraction } from "./schema";
import { extractPosting, formatPosting, type ExtractDeps, type ExtractionOutcome, type PostingText } from "./extract";

export type CachedExtraction = {
  status: "ok" | "failed";
  extraction: Extraction | null;
  error: string | null;
  truncated: boolean;
};

/** Extraction cache keyed by (description hash, prompt version, model). Supabase or in-memory. */
export interface ExtractionStore {
  get(hashes: string[], promptVersion: string, model: string): Promise<Map<string, CachedExtraction>>;
  save(hash: string, promptVersion: string, model: string, value: CachedExtraction): Promise<void>;
}

/** Cache key part: the prompt version plus the answer-check version (e.g. "extract-v2/check-2"). */
export function extractionCacheVersion(promptVersion: string): string {
  return `${promptVersion}/${EXTRACTION_CHECK_VERSION}`;
}

export type ExtractManyResult = {
  /** Keyed by the caller's id. */
  results: Map<string, CachedExtraction>;
  cacheHits: number;
  modelCalls: number;
  /** Postings skipped because of API errors (quota, outage); not cached, can be retried later. */
  apiErrors: { id: string; error: string }[];
  /** Postings not started because the request deadline passed. */
  outOfTime: string[];
  /** Cache writes that failed. The extraction is still returned (it was already paid for). */
  saveErrors: number;
};

export type ExtractManyDeps = ExtractDeps & {
  store: ExtractionStore;
  concurrency?: number;
  /** Epoch ms after which no new model call is started (Phase 4 request deadline). */
  deadline?: number;
  now?: () => number;
};

/**
 * Extracts many postings: cache first, then the model for misses (limited concurrency).
 * - A cache hit is re-checked against the CURRENT posting: the key is the description hash, but
 *   the model also saw the title and listed locations, which can differ between postings that
 *   share a description (Phase 3 review S5). A hit that no longer grounds is re-extracted.
 * - Schema/grounding failures are cached as "failed" so a bad posting isn't retried on every
 *   search; API errors are not cached.
 */
export async function extractMany(postings: { id: string; text: PostingText }[], deps: ExtractManyDeps): Promise<ExtractManyResult> {
  const now = deps.now ?? Date.now;
  const hashes = new Map(postings.map((posting) => [posting.id, descriptionHash(posting.text.description)]));
  const cacheVersion = extractionCacheVersion(deps.prompt.version);
  const cached = await deps.store.get([...new Set(hashes.values())], cacheVersion, deps.model);

  const results = new Map<string, CachedExtraction>();
  const misses = postings.filter((posting) => {
    const hit = cached.get(hashes.get(posting.id)!);
    if (!hit) return true;
    const stillGrounded =
      hit.status !== "ok" || !hit.extraction || groundingProblems(hit.extraction, formatPosting(posting.text).parts).length === 0;
    if (stillGrounded) results.set(posting.id, hit);
    return !stillGrounded;
  });

  let modelCalls = 0;
  let saveErrors = 0;
  const apiErrors: { id: string; error: string }[] = [];
  const outOfTime: string[] = [];

  const settled = await mapWithConcurrency(misses, deps.concurrency ?? 6, async (posting): Promise<CachedExtraction | null> => {
    if (deps.deadline !== undefined && now() >= deps.deadline) {
      outOfTime.push(posting.id);
      return null;
    }
    const outcome: ExtractionOutcome = await extractPosting(posting.text, deps);
    modelCalls += outcome.attempts;
    const value: CachedExtraction =
      outcome.status === "ok"
        ? { status: "ok", extraction: outcome.extraction, error: null, truncated: outcome.truncated }
        : { status: "failed", extraction: null, error: outcome.error, truncated: outcome.truncated };
    try {
      await deps.store.save(hashes.get(posting.id)!, cacheVersion, deps.model, value);
    } catch {
      saveErrors++;
    }
    return value;
  });

  settled.forEach((result, index) => {
    const id = misses[index].id;
    if (!result.ok) apiErrors.push({ id, error: (result.error as Error).message });
    else if (result.value) results.set(id, result.value);
  });

  return { results, cacheHits: postings.length - misses.length, modelCalls, apiErrors, outOfTime, saveErrors };
}
