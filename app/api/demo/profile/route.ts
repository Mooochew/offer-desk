import { demoStoredProfile } from "@/lib/agent/demo";
import { createSupabaseAgentStore } from "@/lib/agent/supabase-store";
import { errorResponse } from "@/lib/http/api-errors";
import { createAdminSupabase, requireUser } from "@/lib/supabase/server";

/** "Load demo profile": a new-grad CS profile (SoCal or remote, TS/Python/Postgres, max 2 years). */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await requireUser(request);
    const profile = demoStoredProfile();
    await createSupabaseAgentStore(createAdminSupabase(), supabase, user.id).saveProfile(profile);
    return Response.json({ ok: true, profile });
  } catch (error) {
    return errorResponse(error, "demo profile");
  }
}
