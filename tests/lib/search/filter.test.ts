import { describe, expect, it } from "vitest";
import { dedupeJobs, dedupeKey, normalizeCompany, normalizeTitle } from "@/lib/search/dedupe";
import { filterJobs } from "@/lib/search/filter";
import { boardJob } from "./fakes";

const now = new Date("2026-11-10T00:00:00Z");

describe("filterJobs", () => {
  const jobs = [
    boardJob({ title: "Software Engineer, Backend", postedAt: "2026-11-09T00:00:00Z" }),
    boardJob({ title: "Senior Software Engineer", postedAt: "2026-11-09T00:00:00Z" }),
    boardJob({ title: "Software Engineering Intern", postedAt: "2026-11-09T00:00:00Z" }),
    boardJob({ title: "Software Engineer", postedAt: "2026-09-01T00:00:00Z" }), // too old
    boardJob({ title: "Software Engineer", postedAt: null }), // unknown date
    boardJob({ title: "Software Engineer", locations: ["London"], remote: "onsite", postedAt: "2026-11-08T00:00:00Z" }),
    boardJob({ title: "Account Executive", postedAt: "2026-11-09T00:00:00Z" }),
    boardJob({ title: "Full Stack Engineer", postedAt: "2026-11-07T00:00:00Z" }),
  ];
  const criteria = { query: "backend or full-stack", places: ["socal"], remoteOk: true, postedWithinDays: 14 };

  it("counts what each step removed, and the counts add up", () => {
    const { breakdown } = filterJobs(jobs, criteria, now);
    expect(breakdown).toEqual({
      considered: 8,
      droppedRole: 1,
      droppedSeniority: 1,
      droppedInternship: 1,
      droppedAge: 2,
      droppedLocation: 1,
      droppedDuplicates: 0,
      remaining: 2,
    });
  });

  it("returns the remaining jobs newest first", () => {
    const { jobs: kept } = filterJobs(jobs, criteria, now);
    expect(kept.map((job) => job.title)).toEqual(["Software Engineer, Backend", "Full Stack Engineer"]);
  });

  it("drops jobs with no posting date only when an age filter is set", () => {
    const undated = [boardJob({ postedAt: null })];
    expect(filterJobs(undated, { query: "" }, now).jobs).toHaveLength(1);
    expect(filterJobs(undated, { query: "", postedWithinDays: 7 }, now).jobs).toHaveLength(0);
  });

  it("keeps internships when asked", () => {
    const intern = [boardJob({ title: "Software Engineering Intern" })];
    expect(filterJobs(intern, { query: "", includeInternships: true }, now).jobs).toHaveLength(1);
  });

  it("counts duplicates removed", () => {
    const twins = [boardJob({ title: "Software Engineer" }), boardJob({ title: "Software Engineer" })];
    const { breakdown } = filterJobs(twins, { query: "" }, now);
    expect(breakdown.droppedDuplicates).toBe(1);
    expect(breakdown.remaining).toBe(1);
  });
});

describe("dedupe", () => {
  it("normalizes company suffixes and title noise", () => {
    expect(normalizeCompany("Acme, Inc.")).toBe("acme");
    expect(normalizeCompany("Acme LLC")).toBe("acme");
    expect(normalizeTitle("Software Engineer I (New Grad)")).toBe("software engineer");
  });

  it("treats the same job at the same place as one, different places as two", () => {
    const a = boardJob({ company: "Acme Inc", title: "Software Engineer I", locations: ["Austin, TX"] });
    const b = boardJob({ company: "Acme", title: "Software Engineer (New Grad)", locations: ["Austin, TX"] });
    const c = boardJob({ company: "Acme", title: "Software Engineer", locations: ["Denver, CO"] });
    expect(dedupeKey(a)).toBe(dedupeKey(b));
    expect(dedupeKey(a)).not.toBe(dedupeKey(c));
  });

  it("keeps the most recently posted copy", () => {
    const older = boardJob({ postedAt: "2026-11-01T00:00:00Z", url: "https://old" });
    const newer = boardJob({ postedAt: "2026-11-05T00:00:00Z", url: "https://new" });
    const { kept, duplicatesRemoved } = dedupeJobs([older, newer]);
    expect(kept.map((job) => job.url)).toEqual(["https://new"]);
    expect(duplicatesRemoved).toBe(1);
  });
});
