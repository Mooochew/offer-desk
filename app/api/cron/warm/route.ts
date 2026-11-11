import { isCronAuthorized, warmBoardCache } from "@/lib/cron/warm";
import { createSupabaseStore } from "@/lib/search/supabase-store";
import { fetchBoard } from "@/lib/sources";
import { createAdminSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * GET /api/cron/warm: Vercel Cron calls this daily (vercel.json) with `Authorization: Bearer
 * $CRON_SECRET`. It refreshes the demo search's boards and touches Supabase (DECISIONS 033).
 * No model calls. Reading the header first also keeps this handler dynamic (never prerendered).
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await warmBoardCache({ store: createSupabaseStore(createAdminSupabase()), fetchBoard: (board) => fetchBoard(board) });
    console.log("cache warm-up", summary);
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    console.error("cache warm-up failed", error);
    return Response.json({ ok: false, error: "Warm-up failed" }, { status: 500 });
  }
}
