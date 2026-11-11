import { z } from "zod";
import { freshFileLink } from "@/lib/agent/file-links";
import { createSupabaseAgentStore } from "@/lib/agent/supabase-store";
import { errorResponse } from "@/lib/http/api-errors";
import { createAdminSupabase, requireUser } from "@/lib/supabase/server";

/** POST /api/files/:id/url: a fresh signed link for one of the signed-in user's files. */
export async function POST(request: Request, ctx: RouteContext<"/api/files/[id]/url">) {
  try {
    const { user, supabase } = await requireUser(request);
    const { id } = await ctx.params;
    const link = z.uuid().safeParse(id).success ? await freshFileLink(createSupabaseAgentStore(createAdminSupabase(), supabase, user.id), id) : null;
    if (!link) return Response.json({ ok: false, error: "That file doesn't exist." }, { status: 404 });
    return Response.json({ ok: true, ...link });
  } catch (error) {
    return errorResponse(error, "file link");
  }
}
