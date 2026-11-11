import { handleAction } from "@/lib/agent/actions-route";

/** The user pressed Confirm: runs the stored, already-validated action (PLAN 4.5). */
export async function POST(request: Request, ctx: RouteContext<"/api/actions/[id]/confirm">) {
  const { id } = await ctx.params;
  return handleAction(request, id, "confirm");
}
