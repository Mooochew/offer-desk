import { describe, expect, it } from "vitest";
import { checkAnswer, extractPosting, formatPosting, MAX_DESCRIPTION_CHARS } from "@/lib/triage/extract";
import { extractionSchema, groundingProblems } from "@/lib/triage/schema";
import { EXTRACTION_PROMPTS } from "@/prompts";
import { EXTRACT_V2 } from "@/prompts/extract-v2";
import cases from "../../../evals/extraction/cases.json";
import { extraction, fakeModel, POSTING_DESCRIPTION, postingText } from "./fakes";

const source = formatPosting(postingText()).text;
const deps = (answers: Parameters<typeof fakeModel>[0]) => {
  const model = fakeModel(answers);
  return { model, deps: { create: model.create, model: "test-model", prompt: EXTRACT_V2 } };
};

describe("groundingProblems", () => {
  it("accepts quotes copied from the posting, ignoring case, spacing and quote styles", () => {
    expect(groundingProblems(extraction(), source)).toEqual([]);
    const restyled = extraction({ evidence: { ...extraction().evidence, years: "1+   YEARS of professional experience" } });
    expect(groundingProblems(restyled, source)).toEqual([]);
  });

  it("accepts a quote that runs across two bullet lines", () => {
    const acrossBullets = extraction({ evidence: { ...extraction().evidence, years: "1+ years of professional experience BS in Computer Science" } });
    expect(groundingProblems(acrossBullets, source)).toEqual([]);
  });

  it("flags a quote that isn't in the posting (fabricated evidence)", () => {
    const invented = extraction({ evidence: { ...extraction().evidence, years: "3+ years of experience required" } });
    expect(groundingProblems(invented, source)).toEqual([expect.stringContaining("evidence.years is not an exact quote")]);
  });

  it("requires evidence for every non-default answer", () => {
    const unsupported = extraction({
      clearance_required: "yes",
      evidence: { years: null, clearance: null, location: null, new_grad: null },
    });
    expect(groundingProblems(unsupported, source)).toEqual([
      expect.stringContaining("years_required_min is set"),
      expect.stringContaining('clearance_required is "yes"'),
      expect.stringContaining('location_type is "hybrid"'),
    ]);
  });

  it("allows null/unknown answers with no evidence", () => {
    const nothingStated = extraction({
      years_required_min: null,
      years_required_text: null,
      location_type: "unknown",
      evidence: { years: null, clearance: null, location: null, new_grad: null },
    });
    expect(groundingProblems(nothingStated, source)).toEqual([]);
  });
});

describe("extractionSchema (LLM output is untrusted)", () => {
  it.each([
    ["an unknown enum value", { clearance_required: "maybe" }],
    ["negative years", { years_required_min: -1 }],
    ["absurd years", { years_required_min: 99 }],
    ["years as a string", { years_required_min: "3" }],
    ["too many skills", { skills_required: Array.from({ length: 31 }, (_, i) => `skill${i}`) }],
    ["missing evidence object", { evidence: undefined }],
  ])("rejects %s", (_label, override) => {
    expect(extractionSchema.safeParse({ ...extraction(), ...override }).success).toBe(false);
  });

  it("trims an over-long quote instead of rejecting the answer", () => {
    const long = "x".repeat(500);
    const parsed = extractionSchema.parse({ ...extraction(), years_required_text: long, evidence: { ...extraction().evidence, years: long } });
    expect(parsed.years_required_text).toHaveLength(300);
    expect(parsed.evidence.years).toHaveLength(300);
  });
});

describe("checkAnswer", () => {
  it("returns problems for non-JSON output", () => {
    expect(checkAnswer("Sure! Here you go", source)).toEqual({ problems: ["The answer was not valid JSON."] });
  });

  it("reports schema problems with their field path", () => {
    const result = checkAnswer(JSON.stringify({ ...extraction(), degree: "associate" }), source);
    expect(result).toEqual({ problems: [expect.stringMatching(/^degree:/)] });
  });
});

describe("extractPosting", () => {
  it("returns a grounded extraction on the first try", async () => {
    const { deps: d, model } = deps([extraction()]);
    const outcome = await extractPosting(postingText(), d);
    expect(outcome).toMatchObject({ status: "ok", attempts: 1, truncated: false });
    expect(model.requests).toHaveLength(1);
  });

  it("sends the prompt as instructions, few-shot examples as prior turns, and the posting wrapped as data", async () => {
    const { deps: d, model } = deps([extraction()]);
    await extractPosting(postingText(), d);
    const [request] = model.requests;
    expect(request.instructions).toBe(EXTRACT_V2.instructions);
    expect(request.input).toHaveLength(EXTRACT_V2.examples.length * 2 + 1);
    const last = (request.input as { content: string }[]).at(-1)!.content;
    expect(last.startsWith("<posting>\n")).toBe(true);
    expect(last).toContain(POSTING_DESCRIPTION);
    expect(request.text?.format).toMatchObject({ type: "json_schema", strict: true });
    expect(request.store).toBe(false);
  });

  it("retries once with the exact problems when the answer fails validation", async () => {
    const invented = extraction({ evidence: { ...extraction().evidence, years: "5+ years required" } });
    const { deps: d, model } = deps([invented, extraction()]);

    const outcome = await extractPosting(postingText(), d);

    expect(outcome).toMatchObject({ status: "ok", attempts: 2 });
    const retryTurns = model.requests[1].input as { role: string; content: string }[];
    expect(retryTurns.at(-1)!.content).toContain('evidence.years is not an exact quote from the posting: "5+ years required"');
    expect(retryTurns.at(-2)!.role).toBe("assistant");
  });

  it("gives up after the retry and reports why", async () => {
    const { deps: d } = deps(["not json", "still not json"]);
    const outcome = await extractPosting(postingText(), d);
    expect(outcome).toEqual({ status: "failed", error: "The answer was not valid JSON.", attempts: 2, truncated: false });
  });

  it("throws API errors to the caller (not the posting's fault)", async () => {
    const { deps: d } = deps([new Error("HTTP 503")]);
    await expect(extractPosting(postingText(), d)).rejects.toThrow("HTTP 503");
  });

  it("truncates very long descriptions and says so", async () => {
    const { deps: d, model } = deps([extraction({ years_required_min: null, years_required_text: null, location_type: "unknown", evidence: { years: null, clearance: null, location: null, new_grad: null } })]);
    const outcome = await extractPosting(postingText("y".repeat(MAX_DESCRIPTION_CHARS + 500)), d);
    expect(outcome.truncated).toBe(true);
    const sent = (model.requests[0].input as { content: string }[]).at(-1)!.content;
    expect(sent.length).toBeLessThan(MAX_DESCRIPTION_CHARS + 200);
  });
});

describe("prompt versions", () => {
  it.each(Object.values(EXTRACTION_PROMPTS).flatMap((prompt) => prompt.examples.map((example, i) => [prompt.version, i, example] as const)))(
    "%s example %i passes the same schema and grounding checks as real answers",
    (_version, _index, example) => {
      expect(checkAnswer(JSON.stringify(example.output), example.posting)).toEqual({ extraction: example.output });
    },
  );

  it("few-shot examples never come from the eval set (no test-set leakage)", () => {
    const evalCompanies = new Set(cases.cases.map((testCase) => testCase.company.toLowerCase()));
    for (const prompt of Object.values(EXTRACTION_PROMPTS)) {
      for (const example of prompt.examples) {
        const company = /Company: (.+)/.exec(example.posting)![1].toLowerCase();
        expect(evalCompanies.has(company)).toBe(false);
      }
    }
  });

  it("each prompt has a unique version string (it is part of the cache key)", () => {
    const versions = Object.values(EXTRACTION_PROMPTS).map((prompt) => prompt.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
