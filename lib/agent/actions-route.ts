import "server-only";

import { after } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http/api-errors";
import { clientIp } from "@/lib/safety/limits";
import { createAdminSupabase, requireUser } from "@/lib/supabase/server";
import { confirmAction, rejectAction, type ConfirmOutcome } from "./executor";
import { createToolContext, registry } from "./runtime";

const STATUS: Record<ConfirmOutcome["status"], number> = {
  executed: 200,
  rejected: 200,
  failed: 500,
  not_found: 404,
  expired: 410,
  already_handled: 409,
};

const MESSAGES: Partial<Record<ConfirmOutcome["status"], string>> = {
  not_found: "That action doesn't exist.",
  expired: "That action expired before it was confirmed. Nothing changed; ask again if you still want it.",
  already_handled: "That action was already handled.",
};

/** POST /api/actions/:id/confirm|reject. The id comes from the URL; the user from the session. */
export async function handleAction(request: Request, id: string, kind: "confirm" | "reject"): Promise<Response> {
  try {
    const { user, supabase } = await requireUser(request);
    if (!z.uuid().safeParse(id).success) return Response.json({ ok: false, error: MESSAGES.not_found }, { status: 404 });

    const ctx = createToolContext({ admin: createAdminSupabase(), user: supabase, userId: user.id, ip: clientIp(request), background: (task) => after(task) });
    const outcome = kind === "confirm" ? await confirmAction(registry, id, ctx) : await rejectAction(id, ctx);

    const body: Record<string, unknown> = { ok: outcome.status === "executed" || outcome.status === "rejected", status: outcome.status, actionId: id };
    if (outcome.status === "executed") Object.assign(body, { summary: outcome.result.summary, ui: outcome.result.forUI ?? null });
    if (outcome.status === "failed") body.error = outcome.error;
    if (MESSAGES[outcome.status]) body.error = MESSAGES[outcome.status];
    return Response.json(body, { status: STATUS[outcome.status] });
  } catch (error) {
    return errorResponse(error, `action ${kind}`);
  }
}
