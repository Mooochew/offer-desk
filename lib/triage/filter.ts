import type { Extraction } from "./schema";

/** Requirement filters the user can change in chat ("hide anything over 1 year"). */
export type RequirementFilters = {
  maxYears: number;
  /** Drop postings that need a clearance you must already hold. On by default. */
  excludeActiveClearance: boolean;
  /** Also drop postings that need you to be able to obtain a clearance. Off by default. */
  excludeClearanceEligible: boolean;
};

export type DropReason = "years" | "clearance";

/**
 * Decides whether a posting stays, using only grounded hard facts (each backed by a quote the
 * code verified). "New-grad friendly" is a softer judgment and only affects ranking (score.ts),
 * so a residual model mistake can lower a job, never hide it (DECISIONS 034).
 */
export function requirementDropReason(extraction: Extraction, filters: RequirementFilters): DropReason | null {
  if (extraction.years_required_min !== null && extraction.years_required_min > filters.maxYears) return "years";
  if (filters.excludeActiveClearance && extraction.clearance_required === "yes") return "clearance";
  if (filters.excludeClearanceEligible && extraction.clearance_required === "ability_to_obtain") return "clearance";
  return null;
}
