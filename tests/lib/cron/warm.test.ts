import { describe, expect, it } from "vitest";
import { isCronAuthorized, warmBoardCache } from "@/lib/cron/warm";
import type { Board } from "@/lib/sources/types";
import { memoryStore, normalizedJob } from "../search/fakes";

describe("isCronAuthorized", () => {
  it("accepts only the exact Bearer secret", () => {
    expect(isCronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isCronAuthorized("Bearer wrong!", "s3cret")).toBe(false);
    expect(isCronAuthorized("s3cret", "s3cret")).toBe(false);
    expect(isCronAuthorized(null, "s3cret")).toBe(false);
  });

  it("refuses everything when no secret is configured (closed by default)", () => {
    expect(isCronAuthorized("Bearer ", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
  });
});

describe("warmBoardCache", () => {
  const boards: Board[] = [
    { name: "A", ats: "greenhouse", slug: "a", tags: ["socal"] },
    { name: "B", ats: "lever", slug: "b", tags: [] },
    { name: "C", ats: "ashby", slug: "c", tags: [] },
  ];

  it("refreshes the selected boards into the shared cache and reports the counts", async () => {
    const { store, entries, savedPostings } = memoryStore();
    const fetched: string[] = [];
    const summary = await warmBoardCache({
      store,
      boards,
      fetchBoard: async (board) => {
        fetched.push(board.slug);
        if (board.slug === "c") throw new Error("down");
        return [normalizedJob({ sourceId: `${board.slug}1`, title: "Backend Engineer" })];
      },
    });
    expect(fetched.sort()).toEqual(["a", "b", "c"]);
    expect(summary).toEqual({ boards: 3, refreshed: 2, cached: 0, failed: 1, jobs: 2 });
    expect(entries.size).toBe(3); // the failure is cached too, so graders don't retry it at once
    expect(savedPostings).toHaveLength(2);
  });

  it("leaves fresh boards alone on a second run", async () => {
    const { store } = memoryStore();
    const fetchBoard = async (board: Board) => [normalizedJob({ sourceId: `${board.slug}1`, title: "Backend Engineer" })];
    await warmBoardCache({ store, boards, fetchBoard });
    const again = await warmBoardCache({ store, boards, fetchBoard });
    expect(again).toMatchObject({ refreshed: 0, cached: 3 });
  });
});
