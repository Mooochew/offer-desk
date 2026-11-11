// Live check of Phase 4: the demo script (PLAN section 9) through the real HTTP API, plus safety
// probes (confirmation, double confirm, another user's action, cancel). Uses real Supabase, job
// boards and OpenAI, and counts against the daily quota like real traffic.
// Run against a local build:  npm run build && npm start   then   npm run check:agent
// Or the deployment:          BASE_URL=https://offer-desk-teal.vercel.app npm run check:agent
// Test users and their files are deleted at the end.

import { createClient } from "@supabase/supabase-js";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const TIMEZONE = "America/Los_Angeles";

let failures = 0;
function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
}

type Event = { type: string; [key: string]: unknown };
type Turn = { ok: boolean; events: Event[]; final: string; toolCalls: number; error?: string };

const createdUsers: string[] = [];
async function anonymousUser() {
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session) throw new Error(`anonymous sign-in failed: ${error?.message}`);
  createdUsers.push(data.user!.id);
  return { id: data.user!.id, token: data.session.access_token };
}

async function post(path: string, token: string | null, body?: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

async function turn(token: string, message: string): Promise<Turn> {
  const started = Date.now();
  const { status, body } = await post("/api/agent", token, { message, timezone: TIMEZONE });
  const result = body as unknown as Turn;
  console.log(`\n» ${message}\n  HTTP ${status} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const event of result?.events ?? []) {
    if (event.type === "step_done") console.log(`  · ${event.tool} → ${event.status}: ${event.summary} (${event.durationMs} ms)`);
    if (event.type === "pending_action") console.log(`  ⏸ pending: ${(event.preview as { title: string }).title}`);
    if (event.type === "error") console.log(`  ! ${event.code}: ${event.message}`);
  }
  console.log(`  ← ${result?.final?.replace(/\n/g, "\n    ")}`);
  check(`turn returns 200`, status === 200, `${status}${result?.error ? `: ${result.error}` : ""}`);
  return result ?? { ok: false, events: [], final: "", toolCalls: 0 };
}

const steps = (result: Turn) => result.events.filter((event) => event.type === "step_done");
const ran = (result: Turn, tool: string) => steps(result).some((event) => event.tool === tool && event.status === "executed");
const payloads = (result: Turn, kind: string) => result.events.filter((event) => event.type === "ui_payload" && (event.payload as { kind: string }).kind === kind).map((event) => event.payload as Record<string, unknown>);

try {
  // --- Auth ----------------------------------------------------------------------------------
  check("agent rejects a request without a session", (await post("/api/agent", null, { message: "hi" })).status === 401);
  const userA = await anonymousUser();
  const userB = await anonymousUser();
  check("agent rejects an empty message", (await post("/api/agent", userA.token, { message: "" })).status === 400);

  // --- Demo setup ----------------------------------------------------------------------------
  check("demo profile loads", (await post("/api/demo/profile", userA.token)).status === 200);
  const seed = await post("/api/demo/seed", userA.token);
  check("sample pipeline seeds", seed.status === 200 && (seed.body?.created as number) > 0, JSON.stringify(seed.body));

  // --- 1. Search + triage ----------------------------------------------------------------------
  const find = await turn(userA.token, "Find entry-level backend and full-stack roles in SoCal or remote posted this week");
  check("search_jobs ran", ran(find, "search_jobs"));
  check("triage_results ran", ran(find, "triage_results"));
  check("source status was reported", find.events.some((event) => event.type === "source_status"));
  const triage = payloads(find, "triage")[0] as { ranked: { ref: string; job: { company: string } }[] } | undefined;
  const ranked = triage?.ranked ?? [];
  check("triage ranked some jobs", ranked.length > 0, `${ranked.length}`);

  // --- 2. Save + checklist ---------------------------------------------------------------------
  const count = Math.min(5, ranked.length);
  const save = await turn(userA.token, `Save the top ${count} and give me an apply checklist`);
  check("save_to_pipeline ran", ran(save, "save_to_pipeline"));
  const savedRefs = save.events.find((event) => event.type === "step_started" && event.tool === "save_to_pipeline") as { args: { refs?: string[] } } | undefined;
  check("it saved the ranked top N, in order", JSON.stringify(savedRefs?.args.refs) === JSON.stringify(ranked.slice(0, count).map((item) => item.ref)), `${savedRefs?.args.refs} vs ${ranked.slice(0, count).map((item) => item.ref)}`);
  check("it didn't search again", !ran(save, "search_jobs"));
  check("generate_apply_checklist ran", ran(save, "generate_apply_checklist"));
  const checklist = payloads(save, "file")[0] as { url: string; filename: string } | undefined;
  if (checklist) {
    const text = await (await fetch(checklist.url)).text();
    check("checklist file downloads and is Markdown", text.startsWith("# Apply checklist"), checklist.filename);
  } else check("checklist file card returned", false);

  // --- 3. Applied + interview ------------------------------------------------------------------
  // A company that appears once among the saved jobs; with two SpaceX roles the agent should
  // (and does) ask which one, which is right but not what this step tests.
  const top = ranked.slice(0, count).map((item) => item.job.company);
  const company = top.find((name) => top.filter((other) => other === name).length === 1) ?? ranked[0]?.job.company ?? "the first company";
  const applied = await turn(userA.token, `Mark the first ${count} as applied today. I have an interview with ${company} Thursday at 2`);
  check("update_stage ran", ran(applied, "update_stage"));
  check("create_interview_invite ran", ran(applied, "create_interview_invite"));
  const invite = payloads(applied, "file").find((file) => String(file.filename).endsWith(".ics")) as { url: string; startsLocal: string } | undefined;
  if (invite) {
    const ics = await (await fetch(invite.url)).text();
    check("invite downloads as a calendar file", ics.includes("BEGIN:VEVENT") && /DTSTART:\d{8}T\d{6}Z/.test(ics), invite.startsLocal);
    check("invite is on a Thursday at 2 PM local", /^Thu, .* 2:00 PM/.test(invite.startsLocal), invite.startsLocal);
  } else check("invite file card returned", false);

  // --- 4. Destructive: archive with confirmation -------------------------------------------------
  const before = await admin.from("applications").select("id, stage").eq("user_id", userA.id);
  const archive = await turn(userA.token, "Archive everything I haven't touched in 3 weeks");
  const pending = archive.events.find((event) => event.type === "pending_action") as { actionId: string; preview: { count: number } } | undefined;
  check("archive was proposed, not run", Boolean(pending) && !ran(archive, "archive_applications"));
  // A sentence claiming the archive happened, ignoring negated or conditional ones ("Nothing has been archived yet").
  const claims = archive.final.split(/(?<=[.!?])\s+/).filter((sentence) => !/\b(nothing|not|no|yet|once|after|when|if|will|would)\b|n't/i.test(sentence));
  check("answer doesn't claim it's done", !claims.some((sentence) => /\barchived\b/i.test(sentence)) && /confirm/i.test(archive.final), archive.final.slice(0, 90));
  const afterProposal = await admin.from("applications").select("id, stage").eq("user_id", userA.id);
  check("nothing changed before confirmation", JSON.stringify(afterProposal.data) === JSON.stringify(before.data));

  if (pending) {
    check("another user can't confirm it", (await post(`/api/actions/${pending.actionId}/confirm`, userB.token)).status === 404);
    const confirm = await post(`/api/actions/${pending.actionId}/confirm`, userA.token);
    check("confirm runs the stored action", confirm.status === 200 && confirm.body?.status === "executed", String(confirm.body?.summary));
    check("a second confirm is refused", (await post(`/api/actions/${pending.actionId}/confirm`, userA.token)).status === 409);
    const archived = await admin.from("applications").select("id").eq("user_id", userA.id).eq("stage", "archived");
    check("the previewed number of applications was archived", (archived.data?.length ?? -1) === pending.preview.count, `${archived.data?.length} / ${pending.preview.count}`);
  }

  // --- 5. Funnel --------------------------------------------------------------------------------
  const funnel = await turn(userA.token, "Show my funnel this month");
  check("get_funnel_stats ran", ran(funnel, "get_funnel_stats"));

  // --- 6. Cancel path: propose deleting the checklist, then cancel --------------------------------
  const del = await turn(userA.token, "Delete the apply checklist file");
  const delPending = del.events.find((event) => event.type === "pending_action") as { actionId: string } | undefined;
  check("file delete was proposed", Boolean(delPending));
  if (delPending) {
    const filesBefore = (await admin.from("files").select("id").eq("user_id", userA.id)).data?.length ?? 0;
    const reject = await post(`/api/actions/${delPending.actionId}/reject`, userA.token);
    check("cancel marks it rejected", reject.status === 200 && reject.body?.status === "rejected");
    const files = await admin.from("files").select("id").eq("user_id", userA.id);
    check("the file still exists after cancel", (files.data?.length ?? -1) === filesBefore && filesBefore > 0);
  }

  // --- Audit log ------------------------------------------------------------------------------------
  const log = await admin.from("action_log").select("tool, status, duration_ms").eq("user_id", userA.id);
  const rows = log.data ?? [];
  check("every tool call is in the action log", rows.length >= 8, `${rows.length} rows`);
  check("no action is left in 'proposed'", rows.every((row) => row.status !== "proposed"));
  check("archive is logged as executed after confirm", rows.some((row) => row.tool === "archive_applications" && row.status === "executed"));
  check("cancelled delete is logged as rejected", rows.some((row) => row.tool === "delete_files" && row.status === "rejected"));
  const otherLog = await admin.from("action_log").select("id").eq("user_id", userB.id);
  check("user B's log is empty", (otherLog.data?.length ?? 0) === 0);
} catch (error) {
  failures++;
  console.error("✗ check crashed:", error);
} finally {
  for (const id of createdUsers) {
    const { data: objects } = await admin.storage.from("exports").list(id, { limit: 100 });
    for (const folder of objects ?? []) {
      const { data: inner } = await admin.storage.from("exports").list(`${id}/${folder.name}`);
      const paths = (inner ?? []).map((file) => `${id}/${folder.name}/${file.name}`);
      if (paths.length) await admin.storage.from("exports").remove(paths);
    }
    await admin.from("action_log").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

console.log(failures === 0 ? "\nAgent check passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
