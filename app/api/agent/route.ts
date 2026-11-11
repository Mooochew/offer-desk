import { after } from "next/server";
import { z } from "zod";
import { runTurn } from "@/lib/agent/loop";
import { callerFor, counterFor, createToolContext, createTurnDeps } from "@/lib/agent/runtime";
import { badRequest, errorResponse, readJson } from "@/lib/http/api-errors";
import { checkChatLimit, clientIp } from "@/lib/safety/limits";
import { createAdminSupabase, requireUser } from "@/lib/supabase/server";

/** Hobby maximum, as headroom; a turn aims to finish well under a minute (lib/agent/runtime.ts). */
export const maxDuration = 300;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  timezone: z.string().max(64).optional(),
});

/** One agent turn: natural language in, validated and logged tool calls, turn events out. */
export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const { user, supabase } = await requireUser(request);
    const body = bodySchema.safeParse(await readJson(request));
    if (!body.success) return badRequest("Send { message: string (1-2000 chars), timezone?: string }.");

    const admin = createAdminSupabase();
    const ip = clientIp(request);
    await checkChatLimit(counterFor(admin), callerFor(user.id, ip));

    const ctx = createToolContext({ admin, user: supabase, userId: user.id, ip, timezone: body.data.timezone, background: (task) => after(task), startedAt });
    const result = await runTurn(body.data.message, createTurnDeps(ctx, admin, startedAt));
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error, "agent turn");
  }
}
