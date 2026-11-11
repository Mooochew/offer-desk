import { describe, expect, it } from "vitest";
import ashbyBoard from "../../fixtures/ashby-board.json";
import greenhouseJob from "../../fixtures/greenhouse-job.json";
import greenhouseList from "../../fixtures/greenhouse-list.json";
import leverPostings from "../../fixtures/lever-postings.json";
import { fetchAshbyBoard, normalizeAshbyJob } from "@/lib/sources/ashby";
import { fetchGreenhouseBoard, fetchGreenhouseDescription, normalizeGreenhouseJob } from "@/lib/sources/greenhouse";
import { fetchLeverBoard, leverDescription, normalizeLeverPosting } from "@/lib/sources/lever";
import { safeUrl } from "@/lib/sources/normalize";
import type { Board } from "@/lib/sources/types";

const board = (ats: Board["ats"], name = "Test Co", slug = "testco"): Board => ({ name, ats, slug, tags: [] });

/** fetch that always returns `body` and records the URLs it was called with. */
function fetchReturning(body: unknown) {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
  return { impl, urls };
}

describe("Greenhouse (recorded Discord board)", () => {
  const [first] = greenhouseList.jobs;
  const job = normalizeGreenhouseJob(board("greenhouse", "Discord"), first);

  it("maps the list entry without a description (pass one)", () => {
    expect(job).toMatchObject({
      source: "greenhouse",
      sourceId: String(first.id),
      company: "Discord",
      title: first.title,
      location: "Remote (US)",
      locations: ["Remote (US)"],
      remote: "remote",
      url: first.absolute_url,
      description: null,
    });
  });

  it("uses first_published as the posting date, in ISO form", () => {
    expect(job.postedAt).toBe(new Date(first.first_published).toISOString());
  });

  it("fetches the board list and one job's content as plain text (pass two)", async () => {
    const list = fetchReturning(greenhouseList);
    const jobs = await fetchGreenhouseBoard(board("greenhouse", "Discord", "discord"), { fetchImpl: list.impl });
    expect(jobs).toHaveLength(3);
    expect(list.urls[0]).toBe("https://boards-api.greenhouse.io/v1/boards/discord/jobs");

    const detail = fetchReturning(greenhouseJob);
    const text = await fetchGreenhouseDescription("discord", "123", { fetchImpl: detail.impl });
    expect(detail.urls[0]).toBe("https://boards-api.greenhouse.io/v1/boards/discord/jobs/123");
    expect(text).not.toMatch(/<|&lt;/);
  });

  it("returns null content and handles a missing location", async () => {
    const detail = fetchReturning({ ...greenhouseJob, content: null });
    expect(await fetchGreenhouseDescription("discord", "1", { fetchImpl: detail.impl })).toBeNull();
    const bare = normalizeGreenhouseJob(board("greenhouse"), { ...first, location: null });
    expect(bare.locations).toEqual([]);
    expect(bare.remote).toBe("unknown");
  });
});

describe("Lever (recorded Palantir board)", () => {
  const [engineering] = leverPostings;
  const job = normalizeLeverPosting(board("lever", "Palantir"), engineering);

  it("includes requirements from lists[] in the description (DECISIONS 007)", () => {
    for (const list of engineering.lists) {
      expect(job.description).toContain(list.text.trim());
    }
    expect(job.description).not.toMatch(/<li>/);
  });

  it("uses workplaceType for remote and converts epoch-ms dates", () => {
    expect(job.remote).toBe("hybrid");
    expect(job.postedAt).toBe(new Date(engineering.createdAt).toISOString());
    expect(job.employmentType).toBe("Full-time");
    expect(job.locations).toEqual(engineering.categories.allLocations);
  });

  it("falls back to the primary location when allLocations is missing", () => {
    const posting = { ...engineering, categories: { location: "Denver, CO" } };
    expect(normalizeLeverPosting(board("lever"), posting).locations).toEqual(["Denver, CO"]);
  });

  it("builds a description even with only some parts present", () => {
    expect(leverDescription({ ...engineering, descriptionPlain: "", lists: [], additionalPlain: "Benefits" })).toBe("Benefits");
  });

  it("fetches a board", async () => {
    const lever = fetchReturning(leverPostings);
    const jobs = await fetchLeverBoard(board("lever", "Palantir", "palantir"), { fetchImpl: lever.impl });
    expect(jobs).toHaveLength(2);
    expect(lever.urls[0]).toBe("https://api.lever.co/v0/postings/palantir?mode=json");
  });
});

describe("Ashby (recorded Ramp board)", () => {
  const [remoteJob, hybridJob] = ashbyBoard.jobs;

  it("trims titles (Ramp sends a leading space)", () => {
    expect(hybridJob.title.startsWith(" ")).toBe(true);
    expect(normalizeAshbyJob(board("ashby"), hybridJob).title).toBe(hybridJob.title.trim());
  });

  it("includes secondary locations after the primary one", () => {
    const job = normalizeAshbyJob(board("ashby"), hybridJob);
    expect(job.locations[0]).toBe(hybridJob.location);
    expect(job.locations).toContain("Remote (US)");
  });

  it("prefers workplaceType over isRemote when they disagree (DECISIONS 008)", () => {
    expect(hybridJob.isRemote).toBe(true);
    expect(normalizeAshbyJob(board("ashby"), hybridJob).remote).toBe("hybrid");
    expect(normalizeAshbyJob(board("ashby"), remoteJob).remote).toBe("remote");
  });

  it("skips unlisted jobs when fetching a board", async () => {
    const ashby = fetchReturning(ashbyBoard);
    const jobs = await fetchAshbyBoard(board("ashby", "Ramp", "ramp"), { fetchImpl: ashby.impl });
    expect(ashbyBoard.jobs.some((job) => job.isListed === false)).toBe(true);
    expect(jobs.map((job) => job.sourceId)).not.toContain("unlisted-copy");
    expect(ashby.urls[0]).toBe("https://api.ashbyhq.com/posting-api/job-board/ramp");
  });
});

describe("missing fields and dispatch", () => {
  it("Ashby: no location, no secondary locations, no description", () => {
    const job = normalizeAshbyJob(board("ashby"), { id: "x", title: "Engineer", jobUrl: "https://j", location: null });
    expect(job).toMatchObject({ location: null, locations: [], remote: "unknown", description: null, postedAt: null, employmentType: null });
  });

  it("Lever: no categories, lists or dates", () => {
    const job = normalizeLeverPosting(board("lever"), { id: "x", text: "Engineer", hostedUrl: "https://j" });
    expect(job).toMatchObject({ location: null, locations: [], postedAt: null, employmentType: null, description: null });
  });

  it("Greenhouse: falls back to updated_at when first_published is missing", () => {
    const job = normalizeGreenhouseJob(board("greenhouse"), {
      id: 1,
      title: "Engineer",
      absolute_url: "https://j",
      first_published: null,
      updated_at: "2026-11-01T00:00:00Z",
    });
    expect(job.postedAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it("fetchBoard dispatches to the board's source", async () => {
    const { fetchBoard } = await import("@/lib/sources");
    const ashby = fetchReturning({ jobs: [] });
    expect(await fetchBoard(board("ashby", "Ramp", "ramp"), { fetchImpl: ashby.impl })).toEqual([]);
    expect(ashby.urls[0]).toContain("api.ashbyhq.com");
  });

  it("boards with empty bodies yield no jobs", async () => {
    expect(await fetchGreenhouseBoard(board("greenhouse"), { fetchImpl: fetchReturning({}).impl })).toEqual([]);
    expect(await fetchLeverBoard(board("lever"), { fetchImpl: fetchReturning({}).impl })).toEqual([]);
    expect(await fetchAshbyBoard(board("ashby"), { fetchImpl: fetchReturning({}).impl })).toEqual([]);
  });
});

describe("posting links (review N4)", () => {
  it.each([
    ["https://boards.greenhouse.io/x/jobs/1", "https://boards.greenhouse.io/x/jobs/1"],
    ["http://jobs.example.com/a", "http://jobs.example.com/a"],
    ["javascript:alert(1)", ""],
    ["data:text/html,hi", ""],
    ["/relative/path", ""],
    [null, ""],
  ])("safeUrl(%s) → %j", (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });

  it("drops a job whose link isn't http(s) when fetching a board", async () => {
    const bad = { ...greenhouseList, jobs: [{ ...greenhouseList.jobs[0], absolute_url: "javascript:alert(1)" }, ...greenhouseList.jobs.slice(1)] };
    const jobs = await fetchGreenhouseBoard(board("greenhouse"), { fetchImpl: fetchReturning(bad).impl });
    expect(jobs).toHaveLength(greenhouseList.jobs.length - 1);
    expect(jobs.every((job) => job.url.startsWith("https://"))).toBe(true);
  });
});
