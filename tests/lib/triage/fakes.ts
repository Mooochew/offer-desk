import type { CreateResponse, LlmResponse } from "@/lib/llm/openai";
import type { CachedExtraction, ExtractionStore } from "@/lib/triage/extraction-cache";
import type { Extraction } from "@/lib/triage/schema";

/** A valid, grounded extraction for the posting text in `postingText()`. */
export function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    years_required_min: 1,
    years_required_text: "1+ years of professional experience",
    degree: "bachelors",
    clearance_required: "unknown",
    location_type: "hybrid",
    is_new_grad_friendly: "unknown",
    skills_required: ["TypeScript", "PostgreSQL"],
    skills_preferred: ["Go"],
    evidence: {
      years: "1+ years of professional experience",
      clearance: null,
      location: "in the office three days a week",
      new_grad: null,
    },
    ...overrides,
  };
}

export const POSTING_DESCRIPTION = `About us: we build payments software.
Requirements:
- 1+ years of professional experience
- BS in Computer Science
- TypeScript and PostgreSQL
Nice to have: Go
We work in the office three days a week.`;

export function postingText(description = POSTING_DESCRIPTION) {
  return { title: "Software Engineer", company: "Acme", locations: ["Irvine, CA"], description };
}

/**
 * Fake model: returns the queued answers in order (strings are output_text; Errors are thrown).
 * Records every request. Plain functions, not vi.fn (TESTING.md "Known quirks").
 */
export function fakeModel(answers: (string | Error | Extraction)[]) {
  const requests: Parameters<CreateResponse>[0][] = [];
  const create: CreateResponse = async (params) => {
    requests.push(structuredClone(params));
    const next = answers[Math.min(requests.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    const output_text = typeof next === "string" ? next : JSON.stringify(next);
    return { output_text } satisfies LlmResponse;
  };
  return { create, requests };
}

export function memoryExtractionStore(initial: Record<string, CachedExtraction> = {}) {
  const rows = new Map(Object.entries(initial));
  const store: ExtractionStore = {
    async get(hashes, promptVersion, model) {
      const found = new Map<string, CachedExtraction>();
      for (const hash of hashes) {
        const row = rows.get(`${hash}|${promptVersion}|${model}`);
        if (row) found.set(hash, row);
      }
      return found;
    },
    async save(hash, promptVersion, model, value) {
      rows.set(`${hash}|${promptVersion}|${model}`, value);
    },
  };
  return { store, rows };
}
