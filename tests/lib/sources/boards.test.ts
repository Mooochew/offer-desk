import { describe, expect, it } from "vitest";
import { ALL_BOARDS, selectBoards, tagsFor } from "@/lib/sources/boards";
import { isEngineeringTitle, remoteFrom, toIsoDate, descriptionHash, cleanTitle } from "@/lib/sources/normalize";
import { boardKey, type Board } from "@/lib/sources/types";

describe("board registry (data/ats_boards.json)", () => {
  it("has no duplicate boards", () => {
    const keys = ALL_BOARDS.map(boardKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers all three sources and has SoCal boards for the demo profile", () => {
    expect(new Set(ALL_BOARDS.map((board) => board.ats))).toEqual(new Set(["greenhouse", "ashby", "lever"]));
    expect(ALL_BOARDS.filter((board) => board.tags.includes("socal")).length).toBeGreaterThanOrEqual(5);
  });
});

describe("tagsFor", () => {
  it("finds tags from the query and SoCal from places", () => {
    expect(tagsFor("ML engineer at a fintech", ["Los Angeles"])).toEqual(new Set(["ai", "fintech", "socal"]));
  });

  it("returns no tags for a plain query", () => {
    expect(tagsFor("software engineer", [])).toEqual(new Set());
  });
});

describe("selectBoards", () => {
  const make = (slug: string, ats: Board["ats"], tags: string[] = []): Board => ({ name: slug, ats, slug, tags });
  const boards = [
    make("g1", "greenhouse"),
    make("g2", "greenhouse"),
    make("g3", "greenhouse"),
    make("a1", "ashby"),
    make("l1", "lever", ["gaming"]),
    make("a2", "ashby"),
  ];

  it("puts tag matches first", () => {
    expect(selectBoards(boards, new Set(["gaming"]), 2)[0].slug).toBe("l1");
  });

  // Regression: the registry lists Greenhouse first, and a 60-board cut once picked 57 Greenhouse boards.
  it("rotates sources within the same score so one source can't crowd out the rest", () => {
    expect(selectBoards(boards, new Set(), 4).map((board) => board.slug)).toEqual(["g1", "a1", "l1", "g2"]);
  });

  it("is stable and respects the max", () => {
    expect(selectBoards(boards, new Set(), 3)).toEqual(selectBoards(boards, new Set(), 3));
    expect(selectBoards(boards, new Set(), 100)).toHaveLength(boards.length);
  });
});

describe("normalize helpers", () => {
  it.each([
    ["Software Engineer, Backend", true],
    ["Machine Learning Engineer", true],
    ["Site Reliability Engineer", true],
    ["Account Executive", false],
    ["Solutions Engineer", false],
    ["Engineering Recruiter", false],
  ])("isEngineeringTitle(%s) → %s", (title, expected) => {
    expect(isEngineeringTitle(title)).toBe(expected);
  });

  it("remoteFrom: workplaceType wins, then isRemote, then location text", () => {
    expect(remoteFrom({ workplaceType: "Hybrid", isRemote: true })).toBe("hybrid");
    expect(remoteFrom({ workplaceType: "OnSite" })).toBe("onsite");
    expect(remoteFrom({ isRemote: true })).toBe("remote");
    expect(remoteFrom({ locationText: "Remote (US)" })).toBe("remote");
    expect(remoteFrom({ workplaceType: "unspecified", locationText: "Austin, TX" })).toBe("unknown");
  });

  it("toIsoDate handles strings, epoch ms, and junk", () => {
    expect(toIsoDate("2026-11-09T10:00:00-05:00")).toBe("2026-11-09T15:00:00.000Z");
    expect(toIsoDate(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(toIsoDate("not a date")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });

  it("descriptionHash ignores surrounding whitespace and changes with content", () => {
    expect(descriptionHash("abc")).toBe(descriptionHash("  abc \n"));
    expect(descriptionHash("abc")).not.toBe(descriptionHash("abd"));
  });

  it("cleanTitle collapses whitespace", () => {
    expect(cleanTitle("  Software   Engineer ")).toBe("Software Engineer");
  });
});
