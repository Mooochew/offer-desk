import { requireUser, UnauthorizedError } from "@/lib/supabase/server";

/** Confirms the deployment can verify a session. Used by the shell and for deploy checks. */
export async function POST(request: Request) {
  try {
    const { user } = await requireUser(request);
    return Response.json({
      ok: true,
      userId: user.id,
      isAnonymous: user.is_anonymous ?? false,
    });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : 500;
    return Response.json({ ok: false, error: (error as Error).message }, { status });
  }
}
