import { z } from "zod";

// What the extraction model must return for one posting. The same shape is sent to OpenAI as a
// strict JSON schema (EXTRACTION_JSON_SCHEMA) and re-checked here with zod, because the LLM's
// output is untrusted input (TESTING.md rule 5).

/**
 * Version of the checks below. Part of the extraction cache key, so changing how answers are
 * validated re-runs extraction instead of serving results judged by old rules.
 * check-2: long quotes are trimmed instead of rejected; bullet markers ignored when matching quotes.
 * check-6: a quote made of exact quotes joined with "; " (two bullets in one quote) is accepted.
 * check-5: an ungrounded years_required_text is dropped (not a failure); "no/not require any experience"
 *          supports years = 0 without the word "years".
 * check-4: same as check-3, but the benefits filter matches whole words (crypto ≠ PTO).
 * check-3: quotes must support the answer (number in the years quote, non-negated clearance,
 *          description-only except location, min length, grounded years text, new-grad evidence).
 */
export const EXTRACTION_CHECK_VERSION = "check-6";

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
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** The two parts of what the model saw: the header lines (title/company/locations) and the description. */
export type SourceParts = { header: string; description: string };

const MIN_QUOTE = 8;
const NUMBER_WORDS: Record<number, string> = { 0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten" };
// Year counts that are about the company or benefits, not the candidate's experience.
// Whole words only: "pto" once matched inside "crypto" and rejected Coinbase's real requirement.
const NOT_EXPERIENCE = /\b(vest(s|ed|ing)?|anniversary|founded|holidays?|401\(?k\)?|pto|paid time off)\b|for over \d+ years/;
const NEGATION = /\b(no|not|without|never|nor)\b|n't\b/;

/** Index of the quote in the canonical text, or -1. */
function findQuote(quote: string, text: string): number {
  return canonical(text).indexOf(canonical(quote));
}

/**
 * True if the quote is in the text, or (check-6) every "; "-separated part of it is. The model
 * sometimes joins two requirement bullets with "; ". Each part is still copied word for word, so
 * nothing is invented; every part must be long enough to be evidence on its own.
 */
function isQuoted(quote: string, text: string): boolean {
  if (findQuote(quote, text) >= 0) return true;
  const parts = quote.split(/;\s+/);
  return parts.length > 1 && parts.every((part) => canonical(part).length >= MIN_QUOTE && findQuote(part, text) >= 0);
}

function mentionsNumber(quote: string, value: number): boolean {
  const digits = String(value).replace(".", "\\.");
  if (new RegExp(`(^|[^\\d.])${digits}([^\\d]|$)`).test(quote)) return true;
  const word = NUMBER_WORDS[value];
  if (word !== undefined && new RegExp(`\\b${word}\\b`, "i").test(quote)) return true;
  return value === 0 && NO_EXPERIENCE_NEEDED.test(quote);
}

// Explicit "zero experience" wording, which supports years = 0 without a number or the word "years":
// "no professional experience required", "We do not require any formal experience".
const NO_EXPERIENCE_NEEDED = /\b(no|not require( any)?|without( any)?)\s+(\w+\s+){0,2}experience\b/i;

/** Keeps `years_required_text` only if it is an exact quote from the description; otherwise null. */
export function groundedYearsText(text: string | null, source: SourceParts): string | null {
  return text && canonical(text).length >= MIN_QUOTE && isQuoted(text, source.description) ? text : null;
}

/**
 * Grounding check (check-6). A quote must not only exist in the posting, it must support the
 * answer: the years quote contains that number and is about experience; a clearance quote
 * mentions clearance and isn't negated ("No security clearance required"); only location
 * evidence may come from the header lines. Returns human-readable problems (empty = grounded).
 * This turns "don't make things up" from a request into rules the code enforces.
 */
export function groundingProblems(extraction: Extraction, source: SourceParts): string[] {
  const problems: string[] = [];
  const { evidence } = extraction;

  const quoteProblem = (field: string, quote: string, allowHeader: boolean): string | null => {
    if (canonical(quote).length < MIN_QUOTE) return `${field} is too short to be evidence: "${quote}"`;
    if (isQuoted(quote, source.description)) return null;
    if (allowHeader && isQuoted(quote, source.header)) return null;
    return `${field} is not an exact quote from the ${allowHeader ? "posting" : "description"}: "${quote.slice(0, 80)}"`;
  };

  for (const [field, value] of Object.entries(evidence)) {
    if (!value) continue;
    const problem = quoteProblem(`evidence.${field}`, value, field === "location");
    if (problem) problems.push(problem);
  }
  // years_required_text is a display summary, not evidence: an ungrounded one is dropped by
  // groundedYearsText (check-5) instead of failing the whole answer.

  // Years: quote required, must contain the number, must be about experience.
  if (extraction.years_required_min !== null) {
    const quote = evidence.years;
    if (!quote) problems.push("years_required_min is set but evidence.years is null; quote the sentence that states it");
    else {
      if (!mentionsNumber(quote, extraction.years_required_min)) {
        problems.push(`evidence.years doesn't contain ${extraction.years_required_min}: "${quote.slice(0, 80)}"`);
      }
      const zeroStatedInWords = extraction.years_required_min === 0 && NO_EXPERIENCE_NEEDED.test(quote);
      if (!zeroStatedInWords && !/\b(year|yr)s?\b/i.test(quote)) problems.push("evidence.years doesn't mention years");
      if (NOT_EXPERIENCE.test(canonical(quote))) problems.push("evidence.years is about benefits or the company, not the candidate's experience");
    }
  }

  // Clearance: quote required, must mention clearance; "yes"/"ability" must not be negated.
  if (extraction.clearance_required !== "unknown") {
    const quote = evidence.clearance;
    if (!quote) problems.push(`clearance_required is "${extraction.clearance_required}" but evidence.clearance is null`);
    else if (!/clearance/i.test(quote)) problems.push("evidence.clearance doesn't mention a clearance");
    else if (extraction.clearance_required !== "no") {
      const at = findQuote(quote, source.description);
      const before = at >= 0 ? canonical(source.description).slice(Math.max(0, at - 40), at) : "";
      if (NEGATION.test(canonical(quote)) || NEGATION.test(before)) {
        problems.push(`evidence.clearance is negated ("${quote.slice(0, 60)}"), so it doesn't support "${extraction.clearance_required}"`);
      }
    }
  }

  if (extraction.location_type !== "unknown" && !evidence.location) {
    problems.push(`location_type is "${extraction.location_type}" but evidence.location is null`);
  }
  if (extraction.is_new_grad_friendly !== "unknown" && !evidence.new_grad) {
    problems.push(`is_new_grad_friendly is "${extraction.is_new_grad_friendly}" but evidence.new_grad is null`);
  }
  return problems;
}
