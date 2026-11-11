import { fetchJson, type FetchJsonOptions } from "@/lib/http/retry";
import { escapedHtmlToText } from "@/lib/text/html";
import { cleanTitle, hasUrl, remoteFrom, safeUrl, toIsoDate } from "./normalize";
import type { Board, NormalizedJob } from "./types";

const API = "https://boards-api.greenhouse.io/v1/boards";

type GreenhouseListJob = {
  id: number;
  title: string;
  location?: { name?: string | null } | null;
  absolute_url: string;
  first_published?: string | null;
  updated_at?: string | null;
};

type GreenhouseJobDetail = GreenhouseListJob & { content?: string | null };

/** Normalizes one Greenhouse list entry. The list has no descriptions (DECISIONS 006). */
export function normalizeGreenhouseJob(board: Board, job: GreenhouseListJob): NormalizedJob {
  const location = job.location?.name?.trim() || null;
  return {
    source: "greenhouse",
    sourceId: String(job.id),
    company: board.name,
    title: cleanTitle(job.title),
    location,
    locations: location ? [location] : [],
    remote: remoteFrom({ locationText: location }),
    url: safeUrl(job.absolute_url),
    postedAt: toIsoDate(job.first_published ?? job.updated_at),
    employmentType: null,
    description: null,
    raw: { updated_at: job.updated_at ?? null },
  };
}

/** Fetches a board's job list without content (pass one of the two-pass fetch). */
export async function fetchGreenhouseBoard(board: Board, options?: FetchJsonOptions): Promise<NormalizedJob[]> {
  const body = await fetchJson<{ jobs?: GreenhouseListJob[] }>(`${API}/${board.slug}/jobs`, options);
  return (body.jobs ?? []).map((job) => normalizeGreenhouseJob(board, job)).filter(hasUrl);
}

/** Fetches one job's description (pass two), converted from escaped HTML to plain text. */
export async function fetchGreenhouseDescription(slug: string, jobId: string, options?: FetchJsonOptions): Promise<string | null> {
  const job = await fetchJson<GreenhouseJobDetail>(`${API}/${slug}/jobs/${jobId}`, options);
  return job.content ? escapedHtmlToText(job.content) : null;
}
