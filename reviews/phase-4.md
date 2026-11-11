# Phase 4 Review

**Verdict:** PASS WITH FIXES

Commit reviewed: `733990e` (Phase 4: agent, tools and safety), working tree clean.

The safety core is sound and I checked it from several directions. Destructive tools cannot run from a model call. The only path to `execute` is a stored, confirmed record claimed by one conditional UPDATE, and every user-table query is scoped to the verified user. The live demo script passes end to end against the deployed URL. Nothing blocks Phase 5. The fixes below are about (a) a cost-budget claim that is stronger than what the code enforces, (b) one demo step that gives confusing numbers, (c) audit-log rows that don't reach a terminal status, and (d) one place where the LLM still does date math.

## Commands run

| Command | Result |
|---|---|
| `npm run check` | **Pass.** Lint, typecheck, 30 files / **367 tests passed**, coverage lines 99.06%, statements 97.56%, branches 87.56%, functions 95.06% (floors 90/90/85 unchanged in `vitest.config.ts`). The `next build` output lists all 5 new routes as dynamic. |
| `npm run check:rls` | **Pass.** It also covers the Phase 4 tables: `action_log` user writes denied (42501), cross-user reads denied, `files.storage_path` owner constraint (23514), private `exports` bucket. |
| `npm run check:live` | **Pass.** `/api/agent`, `/api/demo/profile`, `/api/demo/seed` and `/api/actions/:id/confirm` all return 401 without a session on the deployed URL. |
| `npm run check:search` | **Pass** (cached rerun identical, descriptions load as plain text). |
| `npm run check:triage` | **Pass.** Second triage made 0 model calls (25 cache hits). Drops show verified quotes. |
| `BASE_URL=https://offer-desk-teal.vercel.app npm run check:agent` (run **once**) | **Pass, all checks.** Search + triage turn 9.2 s (7,917 considered → 9 → 8 ranked, 1 clearance drop). It saved exactly the ranked top 5 in order with no re-search. Checklist downloads as Markdown, and the `.ics` is Thu Nov 12 2:00 PM PST. Archive was proposed (4) with no DB change before confirm. User B's confirm returned 404, the owner's confirm executed 4, and a second confirm returned 409. Cancelling the delete left the file in place. 10 action_log rows, none left in `proposed`, user B's log empty. |
| `gh run list` | CI green for `733990e` (1m32s). |
| `eval:agent` | **Not run** (budget). I tallied the 6 result files in `evals/agent/results/` instead. They match PROMPTS.md: v1 16/18, v2 17/18, v3 18/18 tuning; v1 and v3 both 12/12 held-out; the later v3 tuning run is 20/21 (one OpenAI outage). |

## Assignment alignment

| Requirement | Status | Where / notes |
|---|---|---|
| LLM integration: send/receive | **Done** | `lib/agent/loop.ts` (Responses API, `store: false`, replayed output items, `function_call_output` by `call_id`). Verified live. |
| LLM integration: API errors | **Done** | `lib/llm/openai.ts` (20 s × 2 attempts, `Retry-After`); `loop.ts:103-109` turns outages and quota errors into an `error` event plus a code-written fallback answer (tested; one real outage appears in the 0005 eval file). |
| LLM integration: rate limiting | **Done, with a gap** | `lib/safety/limits.ts`: chat 15/h per session and 30/h per IP, extraction 75/150 per hour, daily 500 with 400 for extraction. The gap: chat *model calls* have no per-IP bound (S1). |
| Parse LLM output into commands | **Done** | Function calls → `executeToolCall` → JSON parse → zod `.strict()` → refs resolver. Unknown tools, bad JSON and extra fields are logged as `invalid` (tested). |
| Convert to executable operations | **Done** | 15 tools in `lib/agent/tools/`, registry from the same zod schemas sent to OpenAI (`registry.ts:52`). |
| Multiple domains | **Done** | External APIs (search over Greenhouse/Lever/Ashby, OpenAI extraction), database (pipeline CRUD, profile, funnel), files (CSV, Markdown, `.ics` in private Storage with signed URLs). All exercised live. |
| UI: natural-language input | **Planned (Phase 5)** | The API accepts `{message, timezone}`. No UI yet: the deployed URL is a placeholder page. |
| UI: results / status / feedback | **In progress** | Turn events (`step_started/done`, `source_status`, `ui_payload`, `pending_action`, `error`, `final`) and full `forUI` payloads exist. Rendering is Phase 5. |
| Validate LLM output | **Done** | zod on every call; refs only resolve inside the user's ref table; `update_stage` can't archive; dates and times are validated in code (`files.ts:171-173`, `pipeline.ts:75-77`). |
| Graceful errors | **Done** | Typed `ToolError`s go to the model; unexpected errors are logged in full and shown generically; second failure of the same tool ends tool use; `errorResponse` maps 401/429/500. |
| Confirmation for destructive ops | **Done** | `executor.ts:68-87` (prepare → store resolved args + preview → never execute), `executor.ts:118-158` (claim → run stored args). Verified live, including cross-user and double confirm. |
| Audit log of all actions | **Mostly done** | One `action_log` row per executed call, with args, resolved args, preview, status, duration. Gaps: skipped calls are never logged, and some rows never reach a terminal status (S3). |
| Deliverable: GitHub repo | Done | Public; CI green. |
| Deliverable: deployed URL strangers can use | **In progress** | The API works on the URL; a stranger can't use it without the Phase 5 UI. |
| Deliverable: 1–2 min demo video | Planned (Phase 6) | The demo script (PLAN §9) now runs end to end through the API. |

## Findings

### Blocking

None.

### Should fix

**S1. One visitor can still drain the shared daily OpenAI cap through chat. DECISIONS 047 overstates the protection.**
- Where: `lib/safety/limits.ts:8-17, 60-74`, `lib/agent/loop.ts:11` (`MAX_MODEL_CALLS = 8`), `DECISIONS.md:225-227`.
- Problem: the chat budget counts *HTTP turns* (30/h per IP), but one turn can make up to 8 model calls, and `agentQuota` only checks the global `openai:<day>` counter. Per IP per hour that is up to 30 × 8 = 240 agent calls plus 150 extractions, about 390 of the 500 daily cap. Realistically (about 3 calls per turn) it is about 240/h, so one person can exhaust the day in about 2 hours. The 100-call "reserve for chat" protects chat from extraction, not graders from one heavy chatter. DECISIONS 040/047 say "so one visitor can't drain the shared quota". That is not what the code guarantees. Also note: this review session was told about 300 of 500 were already used today by development alone.
- Why it matters: demo/grading is 30%. A grader who hits "Daily AI request limit reached" sees a broken agent.
- Fix: (1) count model calls, not turns, against a per-IP *hourly* and *daily* budget, e.g. `agent:ip:<hash>:<day>` ≤ 120 checked inside `agentQuota(counter, caller)`, the same way `extractionQuota` does. (2) Correct the DECISIONS 047 wording. (3) Run dev evals against a separate counter key prefix, or raise the cap for a day, so rehearsal doesn't eat grading-day budget.

**S2. Demo step 7 ("Show my funnel this month") returns all-time stage counts labelled as a funnel, plus in-range counts that contradict them.**
- Where: `lib/agent/tools/pipeline.ts:168-199`.
- Problem: `range_days` only affects `saved_in_range` and `applied_in_range`. `by_stage`, `funnel` and `response_rate_percent` are all-time. `funnel.saved` means "not archived" (it includes applied/screen/rejected), and `saved_in_range` counts archived rows too. In the live run the model said "Saved: 9, Applied: 8 … Activity in range: **10 saved** and **9 applied**", which looks like the app can't count. That is the step where the "code computes numbers" rule should look best.
- Fix: compute the funnel over applications created within the range (or label the all-time block clearly as `all_time`). Rename `funnel.saved` to `in_pipeline` (or `tracked`), and give the model one unambiguous set. Add a unit test asserting a 40-day-old application is excluded from a 30-day funnel. Also, `withPostings` assigns A# refs to every application (`pipeline.ts:171`); the funnel needs no refs, and this call took 6.2 s live. Use `getPostings` directly.

**S3. Not every model tool call ends in the audit log with a terminal status.**
- Where: `lib/agent/loop.ts:121-126` (calls refused for the cap or a pending action), `loop.ts:115` (function calls in a `mustAnswer` response are dropped silently), `lib/agent/executor.ts:70-72` together with `lib/agent/supabase-store.ts:347-353` (pending actions only become `expired` when someone tries to confirm them).
- Problem: (a) A call the model made but code refused never gets an `action_log` row, and neither does a call in a forced-answer response. The assignment says "log all actions", and these are model-issued commands that were rejected, which is exactly what an audit log should show. (b) A proposal the user ignores stays `awaiting_confirmation` in the log forever, so the Phase 5 action-log panel will show stale "awaiting" chips. (c) A row stays `proposed` or `confirmed` if `updateAction` throws or the function is killed mid-tool (`check:agent` only proves the happy path).
- Fix: (a) log refused calls through the executor path as `invalid` with codes `tool_limit` / `awaiting_confirmation` (one `insertAction` + `updateAction`), and log ignored `mustAnswer` calls the same way. (b) In `buildState` (or a tiny `expireStale(now)` store method), run `update action_log set status='expired' where user_id=? and status='awaiting_confirmation' and expires_at <= now`; add a unit test. (c) Document the residual `proposed`/`confirmed` case in DECISIONS 053, or have the UI render rows older than `maxDuration` as "interrupted".

**S4. The LLM still does relative-date math ("Thursday at 2" → `2026-11-12T14:00`). DECISIONS 050 says code does it.**
- Where: `prompts/system-v3.ts:18` ("Turn 'Thursday at 2' into the next such date"), `lib/agent/tools/files.ts:153-173`, `lib/agent/tools/pipeline.ts:64`, `DECISIONS.md:237-239`.
- Problem: PLAN §1 says "date math is deterministic code". Here the model picks the calendar date, and code only converts the timezone and refuses past times. A wrong-but-future date (next week's Thursday, or a Wednesday) passes every check. The routing eval covers one case (3/3), so it works today, but it breaks the stated core principle, and DECISIONS 050's "converted … in code" reads as if the whole step were code.
- Fix (cheapest): add optional `weekday` (`mon`…`sun`) + `time` (`HH:MM`) arguments to `create_interview_invite`, and have code resolve "the next such weekday" in the user's timezone (`lib/files/time.ts`). Keep `start_local` for explicit dates. At minimum, return `weekday` in `forModel` and correct DECISIONS 050 to say the model chooses the date and code validates and converts it.

**S5. Signed links expire after 1 hour and there's no way to get a new one.**
- Where: `lib/agent/tools/files.ts:12-13` (comment: "the UI can ask for a fresh one later"); no route exists, and the bucket has no user storage policies (`0001_init.sql:267-273`).
- Why it matters: a grader who opens the app, then downloads a file card more than an hour later, gets an expired-token error. Phase 5 will need this anyway.
- Fix: `POST /api/files/[id]/url`: `requireUser`, `getFiles([id])` (user-scoped), prefix check, `signedUrl`. About 20 lines plus a route test (own file 200, another user's file 404).

### Nice to have

- **N1. `refs` + `untouched_days` silently ignores `untouched_days`.** `lib/agent/tools/pipeline.ts:221-224`. With refs, only `stage` is applied as a filter. "Archive A1–A5 if I haven't touched them in 3 weeks" proposes all 5. The preview shows "last touched N days", so the user can catch it, but apply the filter in code too (or reject the combination with a typed error).
- **N2. Eval provenance.** `scripts/eval-agent.mts:171` records `git rev-parse --short HEAD`. All 6 agent result files say `28b7dab`, a commit that contains neither the agent nor the prompts, so the runs came from an uncommitted tree. Together with the single Phase 4 commit, "held-out written after v3 was frozen" can't be checked from history (PROMPTS.md is honest elsewhere). Record a hash of the prompt text and the case file, plus a `dirty` flag.
- **N3. PROMPTS.md:147** says "The set is small (10 cases)". The latest tuning file has 7 cases plus 4 held-out, so 11.
- **N4. Doc drift.** `TESTING.md:13` (Live checks row) doesn't list `check:agent`. `PLAN.md:126, 371` still say `prompts/system.v1.md` and `lib/tools/…` (DECISIONS 043 covers the new layout, but PLAN §4.2 wasn't updated).
- **N5. Route-level status mapping is only partly tested.** `tests/api/agent.test.ts:84-118` covers executed/404/401. The 409 (`already_handled`), 410 (`expired`) and 500 (`failed`) mappings in `lib/agent/actions-route.ts:7-14` are not tested at the route level (the executor tests cover the logic). Add three small cases.
- **N6. Non-destructive overwrites.** `update_profile {skills: []}` replaces the whole skill list. `update_stage` can move up to 100 applications out of later stages (e.g. offer → saved) and overwrites `applied_at`. `create_interview_invite` moves an `offer` back to `interview`. None of these is a confirmation bypass, but note them in DECISIONS 049 as accepted, or refuse backward moves from `offer`.
- **N7. Worst-case turn time isn't bounded by the deadlines.** `TOOLS_MS` only gates *starting* tools. Each model call can take about 41 s (2 × 20 s + backoff), and parallel calls in one response all run even after the deadline (`loop.ts:121`). The worst case is roughly 50 s + 2 model calls ≈ 130 s: inside the 300 s `maxDuration`, but not the "well under a minute" the comment in `runtime.ts:4-8` implies. Consider a shorter agent-call timeout once past `toolDeadline`, and check the deadline inside the per-call loop.
- **N8. Direct-API bypass of confirmation is possible for your own data** (users have RLS delete/update on their own `applications`). That's fine for security, but write it down so nobody claims confirmation is a server-enforced invariant for every client.

## Testing assessment

- **Real and adversarial where it counts.** `tests/lib/agent/executor.test.ts:146-216` attacks the confirmation flow:
  - no record;
  - a confirmed record for a non-destructive tool;
  - tampered `args` after the preview (the stored `resolved_args` still win);
  - a concurrent double confirm (`Promise.all`, exactly one execute);
  - expiry;
  - another user confirming or cancelling;
  - confirm after cancel;
  - a failing execute.

  The in-memory fake (`tests/lib/agent/memory-store.ts:158-163`) enforces the same claim conditions as the SQL (own, awaiting, destructive, not expired), and `tests/lib/agent/supabase-store.test.ts:133-166` checks that the real store emits those filters and sets or filters `user_id` on every user-table query (more than 25 chains), and that profiles and applications use the RLS client. That pair is a good design: logic tested on the fake, query shape tested on the real adapter, and RLS checked live.
- **Second-order injection** is tested with sentinel strings (`SECRET-DESCRIPTION`, `QUOTED-EVIDENCE`, `SECRET-SKILL`) for `triage_results`, `get_posting` and `buildState` (`tools.test.ts:72-84, 107-115`; `loop.test.ts:171-192`). Gap: no test asserts on the *whole* `create()` payload of a turn. One loop test that seeds sentinel text and greps `JSON.stringify(params)` across every model call would cover all tools at once, including future ones.
- **Deadlines and budgets are wired, not just defined**, and tests show it: `runtime.test.ts:35-63` (search budget derived from the deadline, `after()` refresh scheduled only for stale boards, deadline and caller budget passed into triage), `loop.test.ts:143` (no tools after `toolDeadline`), `limits.test.ts:38-67` (session/IP extraction caps, the extraction share stopping while agent calls continue, the daily stop). Live: `check:triage` shows cached runs, and `check:agent` ran the search + triage turn in 9.2 s.
- **Rules followed:** no network in unit tests (fakes only; the URLs are fake hosts), no `.only` or skips, floors not lowered, live checks clean up users, storage objects and action_log rows (`check-agent.mts:159-169`). Prompt changes have numbers (Rule 7).
- **Weaker spots:** the confirm route status mapping (N5), terminal-status gaps (S3) have no tests, and the funnel's range semantics (S2) aren't tested. `runtime.ts` is the least covered agent file (89% lines), which is acceptable since it is wiring.

## Risks to the end goal

1. **Schedule (highest).** Phase 5 (UI, 10% directly, but it carries the 30% demo) and Phase 6 (README, deploy, rehearsal, video) both remain. A stranger can't use the deployed URL until Phase 5 ships. Do S2 and S5 as part of Phase 5, since they touch what the UI shows, and keep the S1 fix small (one counter). Don't add tools.
2. **Quota on recording or grading day.** Development already used about 300 of 500 today. Every `check:agent` run costs about 15–20 calls and every `eval:agent` set about 20–60. Without S1, plus a separate budget for dev runs, the rehearsal and a curious grader compete for the same 500.
3. **Demo numbers.** The live funnel answer (S2) is the one place where the agent currently says something a grader could read as wrong. The rest of the scripted flow worked live, word for word.
4. **Model variance.** DECISIONS 053 notes an occasional re-search before "the top N". It didn't happen in this run, and `check:agent` asserts against it. Rehearse twice on recording day.

## What's done well (verified)

- **Confirmation is structural, not prompt-based.** `executeToolCall` never calls `execute` for destructive tools. `runConfirmedAction` re-reads the record, requires `confirmed`, a destructive tool and a zod-valid `resolved` schema. `claimAction` is one `UPDATE … WHERE user_id AND id AND status AND destructive AND expires_at > now RETURNING`. The ids are frozen at preview time, so a job that goes stale after the preview isn't swept in. Verified live: proposal changed nothing, user B got 404, owner executed exactly the previewed 4, replay got 409.
- **Ownership by construction.** `createSupabaseAgentStore` binds `userId` from `requireUser` (Bearer token, so no CSRF surface). Every admin query filters or sets `user_id`, storage paths are prefix-checked in code *and* by a DB constraint, and `action_log`/`refs`/`files`/`messages` are read-only to users (`check:rls`). Refs resolve only through the user's own ref table, and a resolved A# is re-checked by a user-scoped `listApplications`.
- **The agent model never sees posting text, quotes, skills or "why matched".** `forModel` payloads are refs, enums, counts, scores and clipped company/title/location. Drop reasons are enums. System notes replayed as `developer` messages are code-built strings. A hostile-title case is in the eval.
- **"LLM routes, code computes"** holds everywhere except relative dates (S4): counts, funnel math, filters, scores, file contents, versions (atomic counter) and timezone conversion are all code.
- **Prompt engineering write-up is honest.** It names in-sample vs held-out, says the held-out set doesn't separate v1 from v3, records the v2 regression the eval caught, and doesn't count an OpenAI outage as a routing failure. All the numbers match the result files.
- **Files are careful:** CSV formula-injection guard, Markdown escaping with http(s)-only links, RFC 5545 folding by octets, DST-aware conversion with tests, versioned checklists that never overwrite.
- **Carry-ins from the Phase 2/3 reviews are actually wired:** the deadline goes into search and triage, `maxDuration = 300` is set, stale-while-revalidate runs with `after()`, there are per-session/IP extraction budgets plus the chat reserve, refs use `increment_counter` with a 10-year TTL, and profile fields are clipped in the state builder.
