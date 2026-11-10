import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { CreateResponse } from "@/lib/llm/openai";
import type { ExtractionPrompt } from "@/prompts/types";
import { EXTRACTION_JSON_SCHEMA, extractionSchema, groundedYearsText, groundingProblems, type Extraction, type SourceParts } from "./schema";
import { groundedSkills } from "./skills";

/** Longest description sent to the model. Requirements sections fit well within this. */
export const MAX_DESCRIPTION_CHARS = 12_000;

export type PostingText = {
  title: string;
  company: string;
  locations: string[];
  description: string;
};

export type ExtractionOutcome =
  | { status: "ok"; extraction: Extraction; attempts: number; truncated: boolean }
  | { status: "failed"; error: string; attempts: number; truncated: boolean };

export type ExtractDeps = {
  create: CreateResponse;
  model: string;
  prompt: ExtractionPrompt;
  /** Total model calls allowed per posting: the first try plus one corrective retry. */
  maxAttempts?: number;
};

/** Removes our own delimiter from untrusted text, so a description can't close the <posting> block early. */
function neutralizeDelimiters(text: string): string {
  return text.replace(/<\s*\/?\s*posting\s*>/gi, "[posting]");
}

/**
 * The exact text the model sees, plus its two parts: the header lines (title, company, listed
 * locations) and the description. Evidence quotes are checked against these parts.
 */
export function formatPosting(posting: PostingText): { text: string; parts: SourceParts; truncated: boolean } {
  const truncated = posting.description.length > MAX_DESCRIPTION_CHARS;
  const description = neutralizeDelimiters(truncated ? posting.description.slice(0, MAX_DESCRIPTION_CHARS) : posting.description);
  const header = neutralizeDelimiters(
    [`Title: ${posting.title}`, `Company: ${posting.company}`, `Listed locations: ${posting.locations.join("; ") || "(none listed)"}`].join("\n"),
  );
  return { text: `${header}\n\n${description}`, parts: { header, description }, truncated };
}

function wrap(text: string): string {
  return `<posting>\n${text}\n</posting>`;
}

/** Few-shot examples become prior user/assistant turns. */
function exampleTurns(prompt: ExtractionPrompt): ResponseInputItem[] {
  return prompt.examples.flatMap((example): ResponseInputItem[] => [
    { role: "user", content: wrap(example.posting) },
    { role: "assistant", content: JSON.stringify(example.output) },
  ]);
}

/**
 * Parses and validates one model answer against the posting it came from. Returns the extraction
 * (with skill lists reduced to skills the description really mentions) or a list of problems.
 */
export function checkAnswer(raw: string, source: SourceParts): { extraction: Extraction } | { problems: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { problems: ["The answer was not valid JSON."] };
  }
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) {
    return { problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "answer"}: ${issue.message}`) };
  }
  const problems = groundingProblems(parsed.data, source);
  if (problems.length) return { problems };
  return {
    extraction: {
      ...parsed.data,
      years_required_text: groundedYearsText(parsed.data.years_required_text, source),
      skills_required: groundedSkills(parsed.data.skills_required, source.description),
      skills_preferred: groundedSkills(parsed.data.skills_preferred, source.description),
    },
  };
}

/**
 * Extracts one posting's requirements. If the answer fails schema or grounding checks, the model
 * gets one retry with the exact problems listed (validation-error feedback). API errors (rate
 * limits, quota, outages) are thrown to the caller; they are not the posting's fault.
 */
export async function extractPosting(posting: PostingText, deps: ExtractDeps): Promise<ExtractionOutcome> {
  const { text, parts, truncated } = formatPosting(posting);
  const maxAttempts = deps.maxAttempts ?? 2;
  const input: ResponseInputItem[] = [...exampleTurns(deps.prompt), { role: "user", content: wrap(text) }];
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await deps.create({
      model: deps.model,
      instructions: deps.prompt.instructions,
      input,
      text: { format: { type: "json_schema", name: "job_requirements", strict: true, schema: EXTRACTION_JSON_SCHEMA } },
      reasoning: { effort: "low" },
      max_output_tokens: 4_000,
      store: false,
    });

    const result = checkAnswer(response.output_text, parts);
    if ("extraction" in result) return { status: "ok", extraction: result.extraction, attempts: attempt, truncated };

    lastProblems = result.problems;
    input.push(
      { role: "assistant", content: response.output_text || "(empty answer)" },
      {
        role: "user",
        content: `Your answer had these problems:\n- ${result.problems.join("\n- ")}\nFix them and answer again for the same posting. Evidence must be copied exactly from the posting.`,
      },
    );
  }

  return { status: "failed", error: lastProblems.join("; "), attempts: maxAttempts, truncated };
}
