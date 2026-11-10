// Scores an extraction prompt against the hand-checked labels in evals/extraction/cases.json.
// Run: npm run eval -- extract-v1 [runs=3]
// Prints per-field accuracy next to the trivial "most common label" baseline (LABELING.md),
// lists every mismatch, and saves the raw results to evals/extraction/results/.
// Calls the model directly (no cache, no app quota): each run measures the prompt fresh.

import { mkdirSync, writeFileSync } from "node:fs";
import cases from "@/evals/extraction/cases.json";
import snapshot from "@/data/sample_postings.json";
import { createResponder } from "@/lib/llm/openai";
import { extractPosting } from "@/lib/triage/extract";
import type { Extraction } from "@/lib/triage/schema";
import { mapWithConcurrency } from "@/lib/util/concurrency";
import { EXTRACTION_PROMPTS } from "@/prompts";

const FIELDS = ["years_required_min", "clearance_required", "location_type", "degree", "is_new_grad_friendly"] as const;
type Field = (typeof FIELDS)[number];

const version = process.argv[2] ?? "extract-v1";
const runs = Number(process.argv[3] ?? 3);
const prompt = EXTRACTION_PROMPTS[version];
if (!prompt) throw new Error(`Unknown prompt version ${version}. Known: ${Object.keys(EXTRACTION_PROMPTS).join(", ")}`);
const model = process.env.OPENAI_EXTRACT_MODEL || "gpt-6-luna";

const postings = new Map(snapshot.jobs.map((job) => [`${job.source}:${job.sourceId}`, job]));
const create = createResponder();

/** Accuracy of always answering the most common label for each field. */
function baseline(field: Field): number {
  const counts = new Map<string, number>();
  for (const testCase of cases.cases) {
    const key = String(testCase.expected[field]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / cases.cases.length;
}

type CaseResult = { id: string; status: string; attempts: number; output: Extraction | null; error?: string };
const allRuns: CaseResult[][] = [];

for (let run = 1; run <= runs; run++) {
  const results = await mapWithConcurrency(cases.cases, 6, async (testCase): Promise<CaseResult> => {
    const job = postings.get(`${testCase.source}:${testCase.sourceId}`)!;
    const outcome = await extractPosting(
      { title: job.title, company: job.company, locations: job.locations, description: job.description ?? "" },
      { create, model, prompt },
    );
    return outcome.status === "ok"
      ? { id: testCase.id, status: "ok", attempts: outcome.attempts, output: outcome.extraction }
      : { id: testCase.id, status: "failed", attempts: outcome.attempts, output: null, error: outcome.error };
  });
  allRuns.push(results.map((result, index) => (result.ok ? result.value : { id: cases.cases[index].id, status: "error", attempts: 0, output: null, error: String(result.error) })));
  console.log(`run ${run}/${runs} done`);
}

// Score each field per run, then average over runs.
const perField = Object.fromEntries(FIELDS.map((field) => [field, [] as number[]])) as Record<Field, number[]>;
const mismatches = new Map<string, { field: Field; expected: unknown; got: unknown[] }>();

for (const results of allRuns) {
  for (const field of FIELDS) {
    let correct = 0;
    results.forEach((result, index) => {
      const testCase = cases.cases[index];
      const expected = testCase.expected[field];
      const got = result.output ? result.output[field] : "(failed)";
      if (got === expected) correct++;
      else {
        const key = `${testCase.id}|${field}`;
        const entry = mismatches.get(key) ?? { field, expected, got: [] };
        entry.got.push(got);
        mismatches.set(key, entry);
      }
    });
    perField[field].push(correct / results.length);
  }
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

console.log(`\n${version} on ${model}, ${cases.cases.length} cases × ${runs} runs\n`);
console.log("field                  accuracy   (min–max)       baseline");
for (const field of FIELDS) {
  const values = perField[field];
  console.log(`${field.padEnd(22)} ${pct(mean(values)).padStart(7)}   (${pct(Math.min(...values))}–${pct(Math.max(...values))})   ${pct(baseline(field)).padStart(7)}`);
}
const overall = mean(FIELDS.map((field) => mean(perField[field])));
console.log(`${"overall".padEnd(22)} ${pct(overall).padStart(7)}`);

const flat = allRuns.flat();
const retried = flat.filter((result) => result.attempts > 1).length;
const failed = flat.filter((result) => result.status !== "ok").length;
console.log(`\nanswers needing the corrective retry: ${retried}/${flat.length}; failed after retry: ${failed}/${flat.length}`);

console.log("\nMismatches (expected → got, per run):");
for (const [key, entry] of mismatches) {
  const [id] = key.split("|");
  const company = cases.cases.find((testCase) => testCase.id === id)!.company;
  console.log(`  ${company.padEnd(12)} ${entry.field.padEnd(22)} ${JSON.stringify(entry.expected)} → ${entry.got.map((value) => JSON.stringify(value)).join(", ")}`);
}
for (const result of flat.filter((item) => item.error)) console.log(`  error ${result.id}: ${result.error?.slice(0, 200)}`);

mkdirSync("evals/extraction/results", { recursive: true });
const file = `evals/extraction/results/${version}.json`;
writeFileSync(
  file,
  JSON.stringify(
    {
      version,
      model,
      runs,
      ranAt: new Date().toISOString(),
      accuracy: Object.fromEntries(FIELDS.map((field) => [field, { mean: mean(perField[field]), perRun: perField[field], baseline: baseline(field) }])),
      overall,
      retried,
      failed,
      outputs: allRuns,
    },
    null,
    1,
  ),
);
console.log(`\nSaved ${file}`);
