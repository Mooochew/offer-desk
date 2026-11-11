import snapshot from "@/data/sample_postings.json";
import { demoApplicationRows } from "@/lib/agent/demo";
import { errorResponse } from "@/lib/http/api-errors";
import { loadSnapshotJobs } from "@/lib/search/snapshot";
import { createSupabaseStore } from "@/lib/search/supabase-store";
import { createAdminSupabase, requireUser } from "@/lib/supabase/server";

/**
 * "Seed sample pipeline": real postings from the bundled snapshot as applications with backdated
 * activity. Inserted with the user's own client (RLS); postings already in the pipeline are kept.
 */
export async function POST(request: Request) {
  try {
    const { user, supabase } = await requireUser(request);
    const jobs = await loadSnapshotJobs(snapshot, createSupabaseStore(createAdminSupabase()));
    const rows = demoApplicationRows(jobs, user.id, new Date());
    const { data, error } = await supabase.from("applications").upsert(rows, { onConflict: "user_id,posting_id", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`seed failed: ${error.message}`);
    return Response.json({ ok: true, created: data?.length ?? 0, planned: rows.length });
  } catch (error) {
    return errorResponse(error, "demo seed");
  }
}
