import { loadSessionState } from "@/lib/agent/session-state";
import { createSupabaseAgentStore } from "@/lib/agent/supabase-store";
import { errorResponse } from "@/lib/http/api-errors";
import { createAdminSupabase, requireUser } from "@/lib/supabase/server";

/** POST /api/state: the signed-in user's pipeline, files, action log, chat and latest results. */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await requireUser(request);
    const state = await loadSessionState(createSupabaseAgentStore(createAdminSupabase(), supabase, user.id), new Date());
    return Response.json({ ok: true, ...state });
  } catch (error) {
    return errorResponse(error, "session state");
  }
}
