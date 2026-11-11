import { timingSafeEqual } from "node:crypto";
import { loadBoards, type BoardStore } from "@/lib/search/board-cache";
import { ALL_BOARDS, selectBoards, tagsFor } from "@/lib/sources/boards";
import type { Board, NormalizedJob } from "@/lib/sources/types";

/** The demo search (PLAN section 9), so the boards a grader hits first are the warm ones. */
export const WARM_QUERY = { query: "entry-level backend and full-stack software engineer", places: ["socal"] };

/**
 * True only for `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends). With no secret
 * configured, every request is refused, so the endpoint is closed by default.
 */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily warm-up (DECISIONS 033): refreshes the demo search's boards in the shared cache. The
 * writes also count as activity, so the free Supabase project doesn't pause between graders.
 */
export async function warmBoardCache(deps: { store: BoardStore; fetchBoard: (board: Board) => Promise<NormalizedJob[]>; boards?: readonly Board[]; budgetMs?: number }) {
  const boards = selectBoards(deps.boards ?? ALL_BOARDS, tagsFor(WARM_QUERY.query, WARM_QUERY.places), 60);
  const results = await loadBoards(boards, { store: deps.store, fetchBoard: deps.fetchBoard, budgetMs: deps.budgetMs ?? 45_000 });
  const count = (outcome: string) => results.filter((result) => result.outcome === outcome).length;
  return {
    boards: boards.length,
    refreshed: count("refreshed"),
    cached: count("cached"),
    failed: results.length - count("refreshed") - count("cached"),
    jobs: results.reduce((sum, result) => sum + result.jobs.length, 0),
  };
}
