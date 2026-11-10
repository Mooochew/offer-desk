import { fetchGreenhouseDescription } from "@/lib/sources/greenhouse";
import { mapWithConcurrency } from "@/lib/util/concurrency";

export type PostingForDescription = {
  id: string;
  source: string;
  sourceId: string;
  description: string | null;
  boardSlug: string | null;
};

export interface DescriptionStore {
  getPostings(ids: string[]): Promise<PostingForDescription[]>;
  saveDescription(id: string, description: string): Promise<void>;
}

export type DescriptionDeps = {
  store: DescriptionStore;
  fetchGreenhouse?: (slug: string, jobId: string) => Promise<string | null>;
  concurrency?: number;
};

/**
 * Returns descriptions for the given postings, fetching any missing Greenhouse ones
 * (pass two of DECISIONS 006) and saving them so they're fetched only once.
 * Postings whose description can't be loaded map to null.
 */
export async function loadDescriptions(ids: string[], deps: DescriptionDeps): Promise<Map<string, string | null>> {
  const fetchGreenhouse = deps.fetchGreenhouse ?? ((slug, jobId) => fetchGreenhouseDescription(slug, jobId));
  const postings = await deps.store.getPostings(ids);
  const descriptions = new Map<string, string | null>(ids.map((id) => [id, null]));

  const missing = postings.filter((posting) => !posting.description);
  for (const posting of postings) {
    if (posting.description) descriptions.set(posting.id, posting.description);
  }

  await mapWithConcurrency(missing, deps.concurrency ?? 8, async (posting) => {
    if (posting.source !== "greenhouse" || !posting.boardSlug) return;
    const description = await fetchGreenhouse(posting.boardSlug, posting.sourceId);
    if (!description) return;
    await deps.store.saveDescription(posting.id, description);
    descriptions.set(posting.id, description);
  });

  return descriptions;
}
