import { fetchJson, type FetchJsonOptions } from "@/lib/http/retry";
import { htmlToText } from "@/lib/text/html";
import { cleanTitle, remoteFrom, toIsoDate } from "./normalize";
import type { Board, NormalizedJob } from "./types";

type LeverPosting = {
  id: string;
  text: string;
  categories?: { location?: string; allLocations?: string[]; commitment?: string; team?: string };
  hostedUrl: string;
  createdAt?: number;
  workplaceType?: string;
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
};

/**
 * Builds the full description. Lever keeps requirements ("What We Require") in `lists`,
 * not in `descriptionPlain`, so all three parts are joined (DECISIONS 007).
 */
export function leverDescription(posting: LeverPosting): string {
  const parts = [posting.descriptionPlain?.trim() ?? ""];
  for (const list of posting.lists ?? []) {
    parts.push(`${list.text.trim()}\n${htmlToText(list.content)}`);
  }
  parts.push(posting.additionalPlain?.trim() ?? "");
  return parts.filter(Boolean).join("\n\n");
}

export function normalizeLeverPosting(board: Board, posting: LeverPosting): NormalizedJob {
  const location = posting.categories?.location?.trim() || null;
  const locations = posting.categories?.allLocations?.length ? posting.categories.allLocations : location ? [location] : [];
  return {
    source: "lever",
    sourceId: posting.id,
    company: board.name,
    title: cleanTitle(posting.text),
    location,
    locations,
    remote: remoteFrom({ workplaceType: posting.workplaceType, locationText: location }),
    url: posting.hostedUrl,
    postedAt: toIsoDate(posting.createdAt),
    employmentType: posting.categories?.commitment ?? null,
    description: leverDescription(posting) || null,
    raw: { team: posting.categories?.team ?? null },
  };
}

/** Fetches every posting on a Lever board (descriptions included; Lever has no light mode). */
export async function fetchLeverBoard(board: Board, options?: FetchJsonOptions): Promise<NormalizedJob[]> {
  const postings = await fetchJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${board.slug}?mode=json`, options);
  return (Array.isArray(postings) ? postings : []).map((posting) => normalizeLeverPosting(board, posting));
}
