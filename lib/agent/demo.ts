import demoProfile from "@/data/demo_profile.json";
import { profileSchema } from "@/lib/profile/types";
import type { BoardJob } from "@/lib/sources/types";
import type { Stage, StoredProfile } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;

export function demoStoredProfile(): StoredProfile {
  const profile = profileSchema.parse(demoProfile);
  return { name: profile.name, skills: profile.skills, places: profile.places, remoteOk: profile.remoteOk, maxYears: profile.maxYears, excludeClearanceEligible: false };
}

/** Stage and age (days since last update) of each seeded application, chosen so the demo has
 * something to archive ("untouched in 3 weeks"), something applied, and a response. */
const PLAN: { stage: Stage; daysAgo: number; applied?: number; note?: string }[] = [
  { stage: "saved", daysAgo: 38 },
  { stage: "saved", daysAgo: 30 },
  { stage: "applied", daysAgo: 26, applied: 26 },
  { stage: "rejected", daysAgo: 23, applied: 33, note: "Rejection email, no feedback." },
  { stage: "applied", daysAgo: 9, applied: 9 },
  { stage: "screen", daysAgo: 4, applied: 14, note: "Recruiter screen went well; waiting on next steps." },
  { stage: "saved", daysAgo: 2 },
  { stage: "applied", daysAgo: 1, applied: 1 },
];

/**
 * Rows for the "Seed sample pipeline" button: real postings from the bundled snapshot, one per
 * company, with backdated timestamps. Deterministic for a given snapshot and time.
 */
export function demoApplicationRows(jobs: readonly BoardJob[], userId: string, now: Date) {
  const seen = new Set<string>();
  const picked = [...jobs]
    .sort((a, b) => a.company.localeCompare(b.company) || a.sourceId.localeCompare(b.sourceId))
    .filter((job) => (seen.has(job.company) ? false : (seen.add(job.company), true)))
    .slice(0, PLAN.length);

  const at = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  return picked.map((job, index) => {
    const plan = PLAN[index];
    return {
      user_id: userId,
      posting_id: job.postingId,
      stage: plan.stage,
      applied_at: plan.applied ? at(plan.applied) : null,
      notes: plan.note ? `[${at(plan.daysAgo).slice(0, 10)}] ${plan.note}` : "",
      created_at: at(Math.max(plan.daysAgo, plan.applied ?? 0) + 1),
      updated_at: at(plan.daysAgo),
    };
  });
}
