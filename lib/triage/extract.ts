import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { CreateResponse } from "@/lib/llm/openai";
import type { ExtractionPrompt } from "@/prompts/types";
import { EXTRACTION_JSON_SCHEMA, extractionSchema, groundingProblems, type Extraction } from "./schema";

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

/** The exact text the model sees, and the text evidence quotes are checked against. */
export function formatPosting(posting: PostingText): { text: string; truncated: boolean } {
  const truncated = posting.description.length > MAX_DESCRIPTION_CHARS;
  const description = truncated ? posting.description.slice(0, MAX_DESCRIPTION_CHARS) : posting.description;
  const text = [
    `Title: ${posting.title}`,
    `Company: ${posting.company}`,
    `Listed locations: ${posting.locations.join("; ") || "(none listed)"}`,
    "",
    description,
  ].join("\n");
  return { text, truncated };
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

/** Parses and validates one model answer. Returns the extraction or a list of problems. */
export function checkAnswer(raw: string, sourceText: string): { extraction: Extraction } | { problems: string[] } {
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
  const problems = groundingProblems(parsed.data, sourceText);
  return problems.length ? { problems } : { extraction: parsed.data };
}

/**
 * Extracts one posting's requirements. If the answer fails schema or grounding checks, the model
 * gets one retry with the exact problems listed (validation-error feedback). API errors (rate
 * limits, quota, outages) are thrown to the caller; they are not the posting's fault.
 */
export async function extractPosting(posting: PostingText, deps: ExtractDeps): Promise<ExtractionOutcome> {
  const { text, truncated } = formatPosting(posting);
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

    const result = checkAnswer(response.output_text, text);
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
