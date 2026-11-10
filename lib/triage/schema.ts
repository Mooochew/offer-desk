import { z } from "zod";

// What the extraction model must return for one posting. The same shape is sent to OpenAI as a
// strict JSON schema (EXTRACTION_JSON_SCHEMA) and re-checked here with zod, because the LLM's
// output is untrusted input (TESTING.md rule 5).

/**
 * Version of the checks below. Part of the extraction cache key, so changing how answers are
 * validated re-runs extraction instead of serving results judged by old rules.
 * check-2: long quotes are trimmed instead of rejected; bullet markers ignored when matching quotes.
 */
export const EXTRACTION_CHECK_VERSION = "check-2";

const MAX_QUOTE = 300;
// A long quote is trimmed, not rejected: a prefix of a verified quote is still a verified quote.
const quote = z.string().min(1).transform((text) => text.slice(0, MAX_QUOTE)).nullable();

export const extractionSchema = z.object({
  years_required_min: z.number().min(0).max(30).nullable(),
  years_required_text: z.string().transform((text) => text.slice(0, MAX_QUOTE)).nullable(),
  degree: z.enum(["none", "bachelors", "masters", "phd", "unknown"]),
  clearance_required: z.enum(["yes", "no", "ability_to_obtain", "unknown"]),
  location_type: z.enum(["onsite", "hybrid", "remote", "unknown"]),
  is_new_grad_friendly: z.enum(["yes", "no", "unknown"]),
  skills_required: z.array(z.string().min(1).max(60)).max(30),
  skills_preferred: z.array(z.string().min(1).max(60)).max(30),
  evidence: z.object({
    years: quote,
    clearance: quote,
    location: quote,
    new_grad: quote,
  }),
});

export type Extraction = z.infer<typeof extractionSchema>;

const nullableString = { type: ["string", "null"] };
const stringArray = { type: "array", items: { type: "string" } };

/** OpenAI Structured Outputs schema (strict mode: every field required, no extra fields). */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "years_required_min",
    "years_required_text",
    "degree",
    "clearance_required",
    "location_type",
    "is_new_grad_friendly",
    "skills_required",
    "skills_preferred",
    "evidence",
  ],
  properties: {
    years_required_min: { type: ["number", "null"] },
    years_required_text: nullableString,
    degree: { type: "string", enum: ["none", "bachelors", "masters", "phd", "unknown"] },
    clearance_required: { type: "string", enum: ["yes", "no", "ability_to_obtain", "unknown"] },
    location_type: { type: "string", enum: ["onsite", "hybrid", "remote", "unknown"] },
    is_new_grad_friendly: { type: "string", enum: ["yes", "no", "unknown"] },
    skills_required: stringArray,
    skills_preferred: stringArray,
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["years", "clearance", "location", "new_grad"],
      properties: { years: nullableString, clearance: nullableString, location: nullableString, new_grad: nullableString },
    },
  },
} as const;

/**
 * Lowercases and removes formatting (bullet markers, line breaks, quote and dash styles) so a
 * quote that spans two bullets still matches. Formatting differences aren't fabrication.
 */
function canonical(text: string): string {
  return text
    .replace(/(^|\n)\s*(?:[-*•●▪]|\d+[.)])\s+/g, "$1")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Grounding check: every evidence quote must appear in the source text, and every non-default
 * answer must cite one. Returns human-readable problems (empty = grounded). This is what turns
 * "don't make things up" from a request into a rule the code enforces.
 */
export function groundingProblems(extraction: Extraction, sourceText: string): string[] {
  const source = canonical(sourceText);
  const problems: string[] = [];

  for (const [field, value] of Object.entries(extraction.evidence)) {
    if (value && !source.includes(canonical(value))) {
      problems.push(`evidence.${field} is not an exact quote from the posting: "${value.slice(0, 80)}"`);
    }
  }
  if (extraction.years_required_min !== null && !extraction.evidence.years) {
    problems.push("years_required_min is set but evidence.years is null; quote the sentence that states it");
  }
  if (extraction.clearance_required !== "unknown" && !extraction.evidence.clearance) {
    problems.push(`clearance_required is "${extraction.clearance_required}" but evidence.clearance is null`);
  }
  if (extraction.location_type !== "unknown" && !extraction.evidence.location) {
    problems.push(`location_type is "${extraction.location_type}" but evidence.location is null`);
  }
  return problems;
}
