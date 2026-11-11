import { handleAction } from "@/lib/agent/actions-route";

/** The user pressed Cancel: the stored action is marked rejected; nothing runs. */
export async function POST(request: Request, ctx: RouteContext<"/api/actions/[id]/reject">) {
  const { id } = await ctx.params;
  return handleAction(request, id, "reject");
}
