import type { Profile } from "@/lib/profile/types";
import { inPreferredPlace, isUsRemote } from "@/lib/search/location";
import { hasNewGradSignal } from "@/lib/search/title";
import type { BoardJob } from "@/lib/sources/types";
import { skillInText } from "./skills";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cheap, code-only score used to choose which postings get the (paid, slower) LLM extraction.
 * Signals that are visible without reading the description: a new-grad title, the user's skills
 * in the title, a preferred-place match, and recency. Not shown to the user.
 */
export function preRankScore(job: BoardJob, profile: Profile, now: Date): number {
  let score = 0;
  if (hasNewGradSignal(job.title)) score += 3;
  score += Math.min(2, profile.skills.filter((skill) => skillInText(skill, job.title)).length);

  if (inPreferredPlace(job, profile.places)) score += 1;
  else if (profile.remoteOk && isUsRemote(job)) score += 0.5;

  if (job.postedAt) {
    const ageDays = (now.getTime() - Date.parse(job.postedAt)) / DAY_MS;
    if (ageDays <= 7) score += 2;
    else if (ageDays <= 14) score += 1;
  }
  return score;
}

/** The `limit` most promising jobs (DECISIONS 030). Ties keep the incoming (newest-first) order. */
export function preRank(jobs: readonly BoardJob[], profile: Profile, limit: number, now = new Date()): BoardJob[] {
  return jobs
    .map((job, order) => ({ job, order, score: preRankScore(job, profile, now) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.job);
}
