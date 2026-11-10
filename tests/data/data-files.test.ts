import { describe, expect, it } from "vitest";
import cases from "../../evals/extraction/cases.json";
import snapshot from "../../data/sample_postings.json";
import { snapshotSchema } from "@/lib/search/snapshot";

describe("data/sample_postings.json", () => {
  it("matches the snapshot schema", () => {
    expect(() => snapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("has enough real postings with descriptions for the demo", () => {
    expect(snapshot.jobs.length).toBeGreaterThanOrEqual(50);
    expect(snapshot.jobs.every((job) => (job.description ?? "").length > 200)).toBe(true);
  });
});

describe("evals/extraction/cases.json", () => {
  const ids = new Set(snapshot.jobs.map((job) => `${job.source}:${job.sourceId}`));

  it("every case points at a posting that exists in the snapshot", () => {
    for (const testCase of cases.cases) {
      expect(ids.has(`${testCase.source}:${testCase.sourceId}`), testCase.id).toBe(true);
    }
  });

  it("every label uses an allowed value", () => {
    for (const { expected, id } of cases.cases) {
      expect(["yes", "no", "ability_to_obtain", "unknown"], id).toContain(expected.clearance_required);
      expect(["onsite", "hybrid", "remote", "unknown"], id).toContain(expected.location_type);
      expect(["none", "bachelors", "masters", "phd", "unknown"], id).toContain(expected.degree);
      expect(["yes", "no", "unknown"], id).toContain(expected.is_new_grad_friendly);
      expect(expected.years_required_min === null || expected.years_required_min >= 0, id).toBe(true);
    }
  });
});
