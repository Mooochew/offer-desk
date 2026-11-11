import { getServerEnv } from "@/lib/env/server";
import { requireUser, UnauthorizedError } from "@/lib/supabase/server";

/**
 * Confirms the deployment can verify a session and has its server secrets configured.
 * Reports only whether the secrets parse, never their values.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireUser(request);
    return Response.json({
      ok: true,
      userId: user.id,
      isAnonymous: user.is_anonymous ?? false,
      serverEnvOk: serverEnvIsValid(),
      // Whether the daily warm-up can run (CRON_SECRET set); never the value (Phase 6 review S1).
      cronConfigured: Boolean(process.env.CRON_SECRET),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return Response.json({ ok: false, error: error.message }, { status: 401 });
    }
    console.error("health check failed", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

function serverEnvIsValid(): boolean {
  try {
    getServerEnv();
    return true;
  } catch {
    return false;
  }
}
