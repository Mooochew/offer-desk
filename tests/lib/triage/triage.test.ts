import { describe, expect, it } from "vitest";
import { QuotaExceededError } from "@/lib/llm/openai";
import type { Profile } from "@/lib/profile/types";
import { descriptionHash } from "@/lib/sources/normalize";
import { extractionCacheVersion, extractMany } from "@/lib/triage/extraction-cache";
import { requirementDropReason } from "@/lib/triage/filter";
import { preRank, preRankScore } from "@/lib/triage/prerank";
import { scoreJob } from "@/lib/triage/score";
import { matchingSkills, normalizeSkill, skillInText } from "@/lib/triage/skills";
import { triageJobs } from "@/lib/triage/triage";
import { whyMatched } from "@/lib/triage/why";
import { EXTRACT_V2 } from "@/prompts/extract-v2";
import { boardJob } from "../search/fakes";
import { extraction, fakeModel, memoryExtractionStore, POSTING_DESCRIPTION, postingText } from "./fakes";

const NOW = new Date("2026-11-10T12:00:00Z");
const profile: Profile = { name: null, skills: ["TypeScript", "PostgreSQL", "Go", "React"], places: ["socal"], remoteOk: true, maxYears: 2 };
const filters = { maxYears: 2, excludeActiveClearance: true, excludeClearanceEligible: false };

describe("skills", () => {
  it("normalizes aliases on both sides", () => {
    expect(normalizeSkill("Golang")).toBe("go");
    expect(normalizeSkill(" Postgres ")).toBe("postgresql");
    expect(matchingSkills(["JS", "Postgres", "Rust"], ["JavaScript", "PostgreSQL"])).toEqual(["JS", "Postgres"]);
  });

  it("finds any spelling of a skill (regression: 'Postgres' used to miss the text 'Postgres')", () => {
    expect(skillInText("Postgres", "Experience with Postgres and Redis")).toBe(true);
    expect(skillInText("PostgreSQL", "Experience with Postgres")).toBe(true);
    expect(skillInText("C++", "Strong C++ skills")).toBe(true);
  });

  it("finds a skill as a whole word in a title", () => {
    expect(skillInText("Go", "Backend Engineer (Go)")).toBe(true);
    expect(skillInText("Go", "Google Cloud Engineer")).toBe(false);
    expect(skillInText("React", "React Native Developer")).toBe(true);
  });
});

describe("preRank", () => {
  it("prefers new-grad titles, skill matches, preferred places and recent posts", () => {
    const plain = boardJob({ title: "Software Engineer", locations: ["Denver, CO"], remote: "onsite", postedAt: "2026-10-01T00:00:00Z" });
    const promising = boardJob({ title: "Software Engineer, New Grad (TypeScript)", locations: ["Irvine, CA"], postedAt: "2026-11-09T00:00:00Z" });
    expect(preRankScore(promising, profile, NOW)).toBeGreaterThan(preRankScore(plain, profile, NOW));
    expect(preRank([plain, promising], profile, 1, NOW)).toEqual([promising]);
  });

  it("keeps the incoming order on ties and respects the limit", () => {
    const jobs = [boardJob({ title: "A" }), boardJob({ title: "B" }), boardJob({ title: "C" })];
    expect(preRank(jobs, profile, 2, NOW).map((job) => job.title)).toEqual(["A", "B"]);
  });
});

describe("requirementDropReason (hard facts only)", () => {
  it("drops postings that need more years than allowed; null years pass", () => {
    expect(requirementDropReason(extraction({ years_required_min: 3 }), filters)).toBe("years");
    expect(requirementDropReason(extraction({ years_required_min: 2 }), filters)).toBeNull();
    expect(requirementDropReason(extraction({ years_required_min: null }), filters)).toBeNull();
  });

  it("drops active-clearance roles by default, eligibility only when asked", () => {
    expect(requirementDropReason(extraction({ clearance_required: "yes" }), filters)).toBe("clearance");
    expect(requirementDropReason(extraction({ clearance_required: "ability_to_obtain" }), filters)).toBeNull();
    expect(requirementDropReason(extraction({ clearance_required: "ability_to_obtain" }), { ...filters, excludeClearanceEligible: true })).toBe("clearance");
  });

  // DECISIONS 034: the soft judgment never removes a job.
  it("never drops a job for is_new_grad_friendly = no", () => {
    expect(requirementDropReason(extraction({ is_new_grad_friendly: "no", years_required_min: 2 }), filters)).toBeNull();
  });
});

describe("scoreJob and whyMatched", () => {
  const job = boardJob({ locations: ["Irvine, CA"], postedAt: "2026-11-09T00:00:00Z" });

  it("builds a 0–100 score from skills, new-grad fit, location and recency", () => {
    const score = scoreJob(job, extraction({ is_new_grad_friendly: "yes" }), profile, NOW);
    // Required TypeScript+PostgreSQL (2×2) + preferred Go (1) of possible 2×2+1 → 50; yes → 20; place → 20; ≤3 days → 10.
    expect(score.parts).toEqual({ skills: 50, newGrad: 20, location: 20, recency: 10 });
    expect(score.total).toBe(100);
    expect(score.matchedRequired).toEqual(["TypeScript", "PostgreSQL"]);
    expect(score.matchedPreferred).toEqual(["Go"]);
  });

  it("gives neutral skill credit when the posting lists no skills, and less for unknown/no new-grad fit", () => {
    const score = scoreJob(job, extraction({ skills_required: [], skills_preferred: [], is_new_grad_friendly: "no" }), profile, NOW);
    expect(score.parts.skills).toBe(25);
    expect(score.parts.newGrad).toBe(0);
  });

  it("scores US remote below a preferred place, and nothing for neither", () => {
    expect(scoreJob(boardJob({ locations: ["Remote (US)"], remote: "remote" }), extraction(), profile, NOW).locationReason).toBe("US remote");
    expect(scoreJob(boardJob({ locations: ["Denver, CO"], remote: "onsite" }), extraction(), profile, NOW).parts.location).toBe(0);
  });

  it("writes the why line only from extracted fields and the score", () => {
    const fields = extraction({ is_new_grad_friendly: "yes", years_required_min: 0, clearance_required: "ability_to_obtain" });
    expect(whyMatched(fields, scoreJob(job, fields, profile, NOW))).toBe(
      "Matches TypeScript, PostgreSQL, Go · 0 years required · new-grad friendly · in your area · needs clearance eligibility",
    );
    const remote = boardJob({ locations: ["Remote (US)"], remote: "remote" });
    const none = extraction({ years_required_min: null, skills_required: [], skills_preferred: [] });
    expect(whyMatched(none, scoreJob(remote, none, profile, NOW))).toBe("years not stated · remote (US)");
  });

  it("caps the listed skills at four", () => {
    const many = extraction({ skills_required: ["TypeScript", "PostgreSQL", "Go", "React", "Rust"] });
    const wide = { ...profile, skills: ["TypeScript", "PostgreSQL", "Go", "React", "Rust"] };
    expect(whyMatched(many, scoreJob(job, many, wide, NOW))).toMatch(/^Matches TypeScript, PostgreSQL, Go, React \+1 · 1\+ yr/);
  });
});

describe("extractMany", () => {
  const posting = { id: "p1", text: postingText() };
  const key = `${descriptionHash(POSTING_DESCRIPTION)}|${extractionCacheVersion(EXTRACT_V2.version)}|m`;

  it("serves cached results without calling the model", async () => {
    const { store } = memoryExtractionStore({ [key]: { status: "ok", extraction: extraction(), error: null, truncated: false } });
    const model = fakeModel([new Error("should not be called")]);
    const result = await extractMany([posting], { create: model.create, model: "m", prompt: EXTRACT_V2, store });
    expect(result).toMatchObject({ cacheHits: 1, modelCalls: 0 });
    expect(model.requests).toHaveLength(0);
  });

  it("caches successes and validation failures, but not API errors", async () => {
    const { store, rows } = memoryExtractionStore();
    const ok = await extractMany([posting], { create: fakeModel([extraction()]).create, model: "m", prompt: EXTRACT_V2, store });
    expect(ok.modelCalls).toBe(1);
    expect(rows.get(key)?.status).toBe("ok");

    const failing = memoryExtractionStore();
    await extractMany([posting], { create: fakeModel(["nope"]).create, model: "m", prompt: EXTRACT_V2, store: failing.store });
    expect(failing.rows.get(key)?.status).toBe("failed");

    const down = memoryExtractionStore();
    const result = await extractMany([posting], { create: fakeModel([new Error("HTTP 429")]).create, model: "m", prompt: EXTRACT_V2, store: down.store });
    expect(result.apiErrors).toEqual([{ id: "p1", error: "HTTP 429", quota: false }]);
    expect(down.rows.size).toBe(0);
  });

  it("starts no new model calls after the deadline and reports those postings", async () => {
    const model = fakeModel([extraction()]);
    const result = await extractMany([posting, { id: "p2", text: postingText(`${POSTING_DESCRIPTION}\nmore`) }], {
      create: model.create,
      model: "m",
      prompt: EXTRACT_V2,
      store: memoryExtractionStore().store,
      deadline: 1000,
      now: () => 2000,
    });
    expect(result.outOfTime).toEqual(["p1", "p2"]);
    expect(model.requests).toHaveLength(0);
  });

  it("still returns a paid-for extraction when the cache write fails", async () => {
    const { store } = memoryExtractionStore();
    store.save = async () => {
      throw new Error("db down");
    };
    const result = await extractMany([posting], { create: fakeModel([extraction()]).create, model: "m", prompt: EXTRACT_V2, store });
    expect(result.results.get("p1")?.status).toBe("ok");
    expect(result.saveErrors).toBe(1);
  });

  // Phase 3 review S5: same description, different listed locations → the cached location quote no longer grounds.
  it("re-extracts a cache hit whose evidence doesn't ground in the current posting", async () => {
    const cachedFromOtherPosting = extraction({ location_type: "remote", evidence: { ...extraction().evidence, location: "Listed locations: Remote (US)" } });
    const { store } = memoryExtractionStore({ [key]: { status: "ok", extraction: cachedFromOtherPosting, error: null, truncated: false } });
    const model = fakeModel([extraction()]);
    const result = await extractMany([posting], { create: model.create, model: "m", prompt: EXTRACT_V2, store });
    expect(result.cacheHits).toBe(0);
    expect(model.requests).toHaveLength(1);
    expect(result.results.get("p1")?.extraction?.location_type).toBe("hybrid");
  });

  it("keys the cache by prompt version and answer-check version", () => {
    expect(extractionCacheVersion("extract-v2")).toMatch(/^extract-v2\/check-\d+$/);
  });
});

describe("triageJobs", () => {
  it("pre-ranks, extracts, drops on hard facts with evidence, ranks the rest, and counts every step", async () => {
    const jobs = [
      boardJob({ postingId: "keep", title: "Software Engineer, New Grad", locations: ["Irvine, CA"] }),
      boardJob({ postingId: "senior", title: "Software Engineer" }),
      boardJob({ postingId: "clearance", title: "Software Engineer" }),
      boardJob({ postingId: "nodesc", title: "Software Engineer" }),
      boardJob({ postingId: "bad", title: "Software Engineer" }),
      boardJob({ postingId: "skipped", title: "Software Engineer", postedAt: "2025-01-01T00:00:00Z" }),
    ];
    const extraLines: Record<string, string> = {
      keep: "New grads welcome to apply.",
      senior: "Also requires 5+ years of backend experience.",
      clearance: "Requires an active Secret clearance.",
    };
    const descriptions = new Map<string, string | null>(
      jobs.map((job) => [job.postingId, `${POSTING_DESCRIPTION}\n${extraLines[job.postingId] ?? ""}\nposting ${job.postingId}`]),
    );
    descriptions.set("nodesc", null);

    const answers: Record<string, string> = {
      keep: JSON.stringify(extraction({ is_new_grad_friendly: "yes", evidence: { ...extraction().evidence, new_grad: "New grads welcome to apply." } })),
      senior: JSON.stringify(
        extraction({ years_required_min: 5, years_required_text: "5+ years of backend experience", evidence: { ...extraction().evidence, years: "5+ years of backend experience" } }),
      ),
      clearance: JSON.stringify(extraction({ clearance_required: "yes", evidence: { ...extraction().evidence, clearance: "Requires an active Secret clearance." } })),
      bad: "not json",
    };
    const create: Parameters<typeof triageJobs>[3]["create"] = async (params) => {
      const text = JSON.stringify(params.input);
      const id = Object.keys(answers).find((posting) => text.includes(`posting ${posting}`))!;
      return { output_text: answers[id] };
    };

    const result = await triageJobs(jobs, profile, filters, {
      create,
      model: "m",
      prompt: EXTRACT_V2,
      store: memoryExtractionStore().store,
      loadDescriptions: async () => descriptions,
      maxExtract: 5,
      clock: () => NOW,
    });

    expect(result.ranked.map((item) => item.job.postingId)).toEqual(["keep"]);
    expect(result.ranked[0].why).toContain("new-grad friendly");
    expect(result.dropped.map((item) => [item.job.postingId, item.reason])).toEqual([
      ["senior", "years"],
      ["clearance", "clearance"],
    ]);
    expect(result.dropped[0].evidence).toBe("5+ years of backend experience");
    expect(result.notChecked.map((job) => job.postingId)).toEqual(["skipped"]);
    expect(result.unread.map((item) => [item.job.postingId, item.reason]).sort()).toEqual([
      ["bad", "extraction failed"],
      ["nodesc", "no description"],
    ]);
    expect(result.breakdown).toEqual({
      candidates: 6,
      checked: 5,
      notChecked: 1,
      unread: 2,
      droppedYears: 1,
      droppedClearance: 1,
      remaining: 1,
    });
  });

  it("keeps postings visible as 'AI unavailable' when the model is down", async () => {
    const job = boardJob({ postingId: "p" });
    const result = await triageJobs([job], profile, filters, {
      create: fakeModel([new Error("Daily AI request limit (500) reached.")]).create,
      model: "m",
      prompt: EXTRACT_V2,
      store: memoryExtractionStore().store,
      loadDescriptions: async () => new Map([["p", POSTING_DESCRIPTION]]),
      clock: () => NOW,
    });
    expect(result.unread).toEqual([{ job, reason: "AI unavailable", detail: "Daily AI request limit (500) reached." }]);
    expect(result.ranked).toEqual([]);
  });

  // Phase 3 review S6: a used-up budget is its own state, not "AI unavailable".
  it("marks postings 'AI limit reached' when an AI budget is used up", async () => {
    const job = boardJob({ postingId: "p" });
    const result = await triageJobs([job], profile, filters, {
      create: fakeModel([new QuotaExceededError(75, "session")]).create,
      model: "m",
      prompt: EXTRACT_V2,
      store: memoryExtractionStore().store,
      loadDescriptions: async () => new Map([["p", POSTING_DESCRIPTION]]),
      clock: () => NOW,
    });
    expect(result.unread).toEqual([{ job, reason: "AI limit reached", detail: expect.stringContaining("Hourly AI reading limit for this session (75)") }]);
  });
});
