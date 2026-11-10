import type { Extraction } from "./schema";
import type { JobScore } from "./score";

function yearsPhrase(years: number | null): string {
  if (years === null) return "years not stated";
  if (years === 0) return "0 years required";
  return `${years}+ yr${years === 1 ? "" : "s"}`;
}

/**
 * One-line "why it matched", built from extracted fields and the score breakdown only.
 * A template, not an LLM call: free, instant, and it can't state anything the data doesn't
 * hold (DECISIONS 035).
 */
export function whyMatched(extraction: Extraction, score: JobScore): string {
  const parts: string[] = [];

  const skills = [...score.matchedRequired, ...score.matchedPreferred];
  if (skills.length) parts.push(`Matches ${skills.slice(0, 4).join(", ")}${skills.length > 4 ? ` +${skills.length - 4}` : ""}`);

  parts.push(yearsPhrase(extraction.years_required_min));
  if (extraction.is_new_grad_friendly === "yes") parts.push("new-grad friendly");
  if (score.locationReason) parts.push(score.locationReason === "US remote" ? "remote (US)" : "in your area");
  if (extraction.clearance_required === "ability_to_obtain") parts.push("needs clearance eligibility");

  return parts.join(" · ");
}
