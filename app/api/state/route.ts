import { callerFor, counterFor } from "@/lib/agent/runtime";
import { loadSessionState } from "@/lib/agent/session-state";
import { createSupabaseAgentStore } from "@/lib/agent/supabase-store";
import { errorResponse } from "@/lib/http/api-errors";
import { checkStateLimit, clientIp } from "@/lib/safety/limits";
import { createAdminSupabase, requireUser } from "@/lib/supabase/server";

/** POST /api/state: the signed-in user's pipeline, files, action log, chat and latest results. */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await requireUser(request);
    const admin = createAdminSupabase();
    await checkStateLimit(counterFor(admin), callerFor(user.id, clientIp(request)));
    const state = await loadSessionState(createSupabaseAgentStore(admin, supabase, user.id), new Date());
    return Response.json({ ok: true, ...state });
  } catch (error) {
    return errorResponse(error, "session state");
  }
}
