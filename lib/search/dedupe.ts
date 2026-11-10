import type { BoardJob } from "@/lib/sources/types";

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|company|gmbh|plc)\b\.?/g;
// Words that vary between copies of the same job without changing it.
const TITLE_NOISE = /\b(new grad(uate)?|i|1|remote|hybrid|onsite|us|usa)\b/g;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeCompany(company: string): string {
  return normalize(company.toLowerCase().replace(COMPANY_SUFFIXES, ""));
}

export function normalizeTitle(title: string): string {
  return normalize(normalize(title).replace(TITLE_NOISE, ""));
}

/** Exact-match dedupe key: company | title | primary location. No fuzzy matching (known limitation). */
export function dedupeKey(job: Pick<BoardJob, "company" | "title" | "locations">): string {
  return [normalizeCompany(job.company), normalizeTitle(job.title), normalize(job.locations[0] ?? "")].join("|");
}

/**
 * Removes duplicates, keeping the most recently posted copy of each key.
 * (All current sources are company ATS boards, so none is preferred over another.)
 */
export function dedupeJobs<T extends Pick<BoardJob, "company" | "title" | "locations" | "postedAt">>(
  jobs: readonly T[],
): { kept: T[]; duplicatesRemoved: number } {
  const byKey = new Map<string, T>();
  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = byKey.get(key);
    if (!existing || (job.postedAt ?? "") > (existing.postedAt ?? "")) byKey.set(key, job);
  }
  return { kept: [...byKey.values()], duplicatesRemoved: jobs.length - byKey.size };
}
