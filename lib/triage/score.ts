import type { Profile } from "@/lib/profile/types";
import { inPreferredPlace, isUsRemote } from "@/lib/search/location";
import type { BoardJob } from "@/lib/sources/types";
import type { Extraction } from "./schema";
import { matchingSkills } from "./skills";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Points per part, so the UI can show how a score was built. Max total 100. */
export type ScoreBreakdown = {
  skills: number; // 0–50
  newGrad: number; // 0–20
  location: number; // 0–20
  recency: number; // 0–10
};

export type JobScore = {
  total: number;
  parts: ScoreBreakdown;
  matchedRequired: string[];
  matchedPreferred: string[];
  locationReason: "preferred place" | "US remote" | null;
};

/**
 * Scores a job against the profile. All code: the LLM's extracted fields are inputs, the weights
 * and arithmetic are here. Skills: required matches count double, normalized by how many skills
 * the posting lists, so a posting with 3 skills isn't out-scored by one listing 30.
 */
export function scoreJob(job: BoardJob, extraction: Extraction, profile: Profile, now = new Date()): JobScore {
  const matchedRequired = matchingSkills(profile.skills, extraction.skills_required);
  const matchedPreferred = matchingSkills(profile.skills, extraction.skills_preferred).filter((skill) => !matchedRequired.includes(skill));
  const possible = 2 * extraction.skills_required.length + extraction.skills_preferred.length;
  const earned = 2 * matchedRequired.length + matchedPreferred.length;
  // No skills listed: neutral half credit rather than zero.
  const skills = possible === 0 ? 25 : Math.round((50 * earned) / possible);

  const newGrad = { yes: 20, unknown: 8, no: 0 }[extraction.is_new_grad_friendly];

  const inPlace = inPreferredPlace(job, profile.places);
  const remote = profile.remoteOk && isUsRemote(job);
  const locationReason = inPlace ? "preferred place" : remote ? "US remote" : null;
  const location = inPlace ? 20 : remote ? 15 : 0;

  const ageDays = job.postedAt ? (now.getTime() - Date.parse(job.postedAt)) / DAY_MS : Infinity;
  const recency = ageDays <= 3 ? 10 : ageDays <= 7 ? 7 : ageDays <= 14 ? 4 : ageDays <= 30 ? 2 : 0;

  const parts = { skills, newGrad, location, recency };
  return { total: skills + newGrad + location + recency, parts, matchedRequired, matchedPreferred, locationReason };
}
