import type { BoardJob } from "@/lib/sources/types";
import { dedupeJobs } from "./dedupe";
import { matchesLocation, type LocationPreference } from "./location";
import { isInternship, isSeniorTitle, rolesInQuery, titleMatchesRoles } from "./title";

export type SearchCriteria = {
  /** Free text from the user, e.g. "entry-level backend and full-stack roles". */
  query: string;
  places?: string[];
  remoteOk?: boolean;
  postedWithinDays?: number;
  includeInternships?: boolean;
};

/** How many jobs each step removed. Shown in the UI as "140 → 57". */
export type Breakdown = {
  considered: number;
  droppedRole: number;
  droppedSeniority: number;
  droppedInternship: number;
  droppedAge: number;
  droppedLocation: number;
  droppedDuplicates: number;
  remaining: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Applies the code-side search prefilter in a fixed order (role → seniority → internship →
 * age → location → duplicates) and counts what each step removed. Results are newest first.
 */
export function filterJobs(jobs: readonly BoardJob[], criteria: SearchCriteria, now = new Date()): { jobs: BoardJob[]; breakdown: Breakdown } {
  const roles = rolesInQuery(criteria.query);
  const location: LocationPreference = { places: criteria.places ?? [], remoteOk: criteria.remoteOk ?? false };
  const cutoff = criteria.postedWithinDays ? now.getTime() - criteria.postedWithinDays * DAY_MS : null;

  const steps: { key: keyof Breakdown; keep: (job: BoardJob) => boolean }[] = [
    { key: "droppedRole", keep: (job) => titleMatchesRoles(job.title, roles) },
    { key: "droppedSeniority", keep: (job) => !isSeniorTitle(job.title) },
    { key: "droppedInternship", keep: (job) => criteria.includeInternships === true || !isInternship(job.title, job.employmentType) },
    // A job with no posting date can't be shown to be recent, so it fails an age filter.
    { key: "droppedAge", keep: (job) => cutoff === null || (job.postedAt !== null && Date.parse(job.postedAt) >= cutoff) },
    { key: "droppedLocation", keep: (job) => matchesLocation(job, location) },
  ];

  const breakdown: Breakdown = {
    considered: jobs.length,
    droppedRole: 0,
    droppedSeniority: 0,
    droppedInternship: 0,
    droppedAge: 0,
    droppedLocation: 0,
    droppedDuplicates: 0,
    remaining: 0,
  };

  let current = [...jobs];
  for (const step of steps) {
    const kept = current.filter(step.keep);
    breakdown[step.key] = current.length - kept.length;
    current = kept;
  }

  const { kept, duplicatesRemoved } = dedupeJobs(current);
  breakdown.droppedDuplicates = duplicatesRemoved;
  breakdown.remaining = kept.length;

  kept.sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  return { jobs: kept, breakdown };
}
