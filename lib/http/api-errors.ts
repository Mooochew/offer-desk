import { UnauthorizedError } from "@/lib/supabase/server";
import { RateLimitError } from "@/lib/safety/limits";

/** Maps known errors to friendly JSON responses; logs and hides everything else. */
export function errorResponse(error: unknown, where: string): Response {
  if (error instanceof UnauthorizedError) return Response.json({ ok: false, error: error.message }, { status: 401 });
  if (error instanceof RateLimitError) {
    return Response.json(
      { ok: false, error: error.message, retryAfterSeconds: error.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
    );
  }
  console.error(`${where} failed`, error);
  return Response.json({ ok: false, error: "Something went wrong on our side. Please try again." }, { status: 500 });
}

export function badRequest(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/** Reads a JSON body, or null if it isn't JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
