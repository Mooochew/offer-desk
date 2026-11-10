import { describe, expect, it } from "vitest";
import { loadSnapshotJobs, type SnapshotJob } from "@/lib/search/snapshot";
import { memoryStore } from "./fakes";

const saved = (overrides: Partial<SnapshotJob> = {}): SnapshotJob => ({
  boardName: "Acme",
  boardSlug: "acme",
  source: "greenhouse",
  sourceId: "1",
  company: "Acme",
  title: "Software Engineer",
  location: "Remote (US)",
  locations: ["Remote (US)"],
  remote: "remote",
  url: "https://acme.test/1",
  postedAt: "2026-11-01T00:00:00.000Z",
  employmentType: null,
  description: "Text",
  ...overrides,
});

describe("loadSnapshotJobs", () => {
  it("stores snapshot jobs (with descriptions) and returns them as cached jobs", async () => {
    const { store, savedPostings } = memoryStore();
    const jobs = await loadSnapshotJobs(
      { takenAt: "2026-11-10", jobs: [saved(), saved({ sourceId: "2", boardSlug: "beta", source: "ashby" })] },
      store,
    );
    expect(jobs.map((job) => job.postingId)).toEqual(["posting-1", "posting-2"]);
    expect(savedPostings.map((job) => job.description)).toEqual(["Text", "Text"]);
    expect(jobs[0]).not.toHaveProperty("description");
  });

  it("rejects a malformed snapshot file instead of loading garbage", async () => {
    const { store } = memoryStore();
    await expect(loadSnapshotJobs({ takenAt: "x", jobs: [{ title: "no source" }] }, store)).rejects.toThrow();
  });
});
