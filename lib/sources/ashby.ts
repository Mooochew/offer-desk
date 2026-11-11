import { fetchJson, type FetchJsonOptions } from "@/lib/http/retry";
import { cleanTitle, hasUrl, remoteFrom, safeUrl, toIsoDate } from "./normalize";
import type { Board, NormalizedJob } from "./types";

type AshbyJob = {
  id: string;
  title: string;
  location?: string | null;
  secondaryLocations?: { location?: string | null }[];
  isRemote?: boolean | null;
  isListed?: boolean;
  workplaceType?: string | null;
  employmentType?: string | null;
  publishedAt?: string | null;
  jobUrl: string;
  descriptionPlain?: string | null;
  department?: string | null;
};

export function normalizeAshbyJob(board: Board, job: AshbyJob): NormalizedJob {
  const location = job.location?.trim() || null;
  const secondary = (job.secondaryLocations ?? [])
    .map((entry) => entry.location?.trim())
    .filter((value): value is string => Boolean(value));
  return {
    source: "ashby",
    sourceId: job.id,
    company: board.name,
    title: cleanTitle(job.title),
    location,
    locations: [...(location ? [location] : []), ...secondary],
    remote: remoteFrom({ workplaceType: job.workplaceType, isRemote: job.isRemote, locationText: location }),
    url: safeUrl(job.jobUrl),
    postedAt: toIsoDate(job.publishedAt),
    employmentType: job.employmentType ?? null,
    description: job.descriptionPlain?.trim() || null,
    raw: { department: job.department ?? null },
  };
}

/** Fetches a board's listed jobs. Unlisted jobs (isListed: false) are skipped. */
export async function fetchAshbyBoard(board: Board, options?: FetchJsonOptions): Promise<NormalizedJob[]> {
  const body = await fetchJson<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${board.slug}`, options);
  return (body.jobs ?? []).filter((job) => job.isListed !== false).map((job) => normalizeAshbyJob(board, job)).filter(hasUrl);
}
