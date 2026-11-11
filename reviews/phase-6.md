# Phase 6 Review

**Verdict:** PASS WITH FIXES
(No blocking issues. The app is ready to record and submit. Fix S1 before or right after submission, and S2 and S3 when convenient. All three are small.)

## Commands run
- `npm run check` → exit 0. Lint and types clean. **35 test files, 407 tests passed.** Coverage: statements 97.59%, branches 87.6%, functions 95.19%, lines 98.89%. Production build succeeded, and `/api/cron/warm` builds as dynamic (ƒ).
- `npm run check:rls` → "All RLS checks passed."
- `npm run check:live` → "Live smoke test passed." This covers the home page, two distinct anonymous sessions, `serverEnvOk`, and 401s on agent, state, demo/profile, demo/seed, actions/confirm and files/url. It also covers the cron endpoint with no secret and with a wrong secret.
- `curl` against https://offer-desk-teal.vercel.app (no auth): `GET /api/cron/warm` → 401; `POST` → 405; `Authorization: Bearer ` (empty) → 401; `bearer x` → 401; `POST /api/actions/<uuid>/reject` → 401 (`check:live` doesn't cover this route); `/` → 200; HSTS header present.
- `git diff e79c3c8..HEAD` read in full for non-UI code and tests. Read the UI components (offer-desk, chat-panel, confirm-dialog, results-view, ui, icons, globals.css) and grepped pipeline-view and action-log.
- Checked README facts against the repo: 145 boards in `data/ats_boards.json`, 120-posting snapshot, limits in `lib/safety/limits.ts`, Node 24 in CI, file paths in the requirement table, three destructive tools, and the funnel numbers in `docs/screenshots/results.png`.
- **Not run (per the budget instruction):** `check:ui`, `check:agent`, `eval`, `eval:agent`. I did **not** call the cron endpoint with the real secret, so I couldn't confirm the deployed cron actually runs (see S1).

## Assignment alignment
| Requirement | Status | Where / notes |
|---|---|---|
| LLM integration: send/receive | done | `lib/llm/openai.ts` (Responses API) |
| API errors, rate limiting | done | `lib/http/retry.ts` (backoff with jitter, honors Retry-After); `lib/safety/limits.ts` budgets per session, per IP and per day. New in this phase: a per-IP limit on `/api/state` (600/h) |
| Parse LLM output into commands | done | Function calling → `lib/agent/executor.ts`, with a zod schema per tool |
| Execute across domains | done | External APIs (Greenhouse/Lever/Ashby), database (pipeline CRUD), files (CSV/MD/ICS in Storage) |
| UI: NL input, results, status, feedback | done | Three panels, step timeline, source chips (now survive a reload), toasts, file cards |
| Validate LLM output | done | zod on arguments and extractions, ref ownership, grounding checks. Posting URLs are now limited to http(s) at ingestion (N4) |
| Graceful errors | done | Typed errors, partial source failures, friendly 429/5xx messages |
| Confirmation for destructive ops | done | Archive, delete and delete_files only propose. The dialog lists what code resolved. Review now reopens the dialog only for actions the server says are still awaiting confirmation (N9) |
| Audit log | done | `action_log` table, shown live with resolved arguments |
| Deliverable: GitHub repo | done | Public repo, README rewritten for submission |
| Deliverable: deployed URL | done | Live and passing `check:live` today |
| Deliverable: 1–2 min video | planned | `docs/DEMO.md` checklist and script are ready; not yet recorded |

## Findings

### Blocking
None.

### Should fix

**S1. Nothing checks that the deployed cron actually runs. Its keep-alive role matters during grading.** (`app/api/cron/warm/route.ts:14`, `lib/env/server.ts:5-12`, `scripts/smoke-live.ts:52-56`)
- **Problem:** The endpoint is closed by default, which is correct: with no `CRON_SECRET` it refuses every request. But that means a missing or mistyped secret in the Vercel dashboard looks exactly like a working setup. `check:live` only shows that bad requests get 401. `CRON_SECRET` isn't in the server env schema, so `serverEnvOk` doesn't cover it either. The local `.env.local` has a value; I couldn't check Vercel's (**unverified**).
- **Why it matters:** DECISIONS 033 and 062 rely on this job to keep the free Supabase project from pausing after a week with no activity. If grading starts more than a week after the last visit and the cron has been returning 401 every day, a grader's first load fails: no session, no app. That's the demo URL criterion.
- **Fix:** In the Vercel dashboard, go to Settings → Cron Jobs and click "Run". Then confirm the function log shows `cache warm-up { ok... }` and a 200 response. It costs no model calls. Optionally, make this checkable: add `cronConfigured: Boolean(process.env.CRON_SECRET)` to `/api/health` and assert it in `check:live`.

**S2. The chat composer, the app's main input, lost its visible keyboard focus indicator.** (`components/chat-panel.tsx`, the textarea `className="... outline-none ... focus-visible:outline-none"`, and the form's `focus-within:border-border-strong`)
- **Problem:** Before the restyle, the textarea used the global `:focus-visible` outline (2px accent). Now that outline is turned off, and the only cue is the form border changing from `#e6e5e2` to `#d4d3cf`, about 1.2:1 against each other. That isn't visible. All other controls still get the global outline.
- **Why it matters:** This breaks the project's own rule ("Keyboard focus is always visible", `app/globals.css:110`) and WCAG 2.4.7. It's also the first thing a keyboard user tabs to.
- **Fix:** Put the indicator on the wrapper, for example `focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30` on the `<form>`, or remove `focus-visible:outline-none` from the textarea.

**S3. The project status docs still say "Phase 6 next".** (`PLAN.md:3`, `HANDOFF.md:3` and `:22`)
- **Problem:** `PLAN.md:3` says "Phases 0–5 done; Phase 6 (ship) next". `HANDOFF.md` says "Updated … end of Phase 5 … Phase 6 (ship) is next" and lists e9b82b9 as the last deployed commit.
- **Why it matters:** Graders reading the repo see docs that contradict the README and DECISIONS 061/062. That's a small hit to the design/implementation impression.
- **Fix:** After recording, update both status lines to "Phase 6 done; submitted", note the deployed commit, and link `reviews/phase-6.md`.

**S4. Nothing tests that `/api/state` actually applies the new limit.** (`app/api/state/route.ts:12`; `tests/api/` has only agent, cron and health)
- **Problem:** `checkStateLimit` has a unit test, but no test calls the route and checks that it applies the limit or returns 429 with `Retry-After`. If someone dropped the `await` or the call in a refactor, every test would still pass. The same applies to the N1 path from route to `sourceStatus`, which is tested only at the `loadSessionState` level.
- **Why it matters:** TESTING.md treats safety rules as needing tests that try to break them. This limit is a safety rule.
- **Fix:** Add `tests/api/state.test.ts` in the style of `cron.test.ts`. Mock `requireUser` and `counterFor` (have the counter return 601), then assert a 429, a `Retry-After` header, and that `loadSessionState` was not called.

### Nice to have

- **N1. The warm-up summary counts stale and skipped boards as failed.** `lib/cron/warm.ts:32` computes `failed` as `results.length - refreshed - cached`, so boards served stale or skipped by the 45 s budget count as "failed". Only the logs are affected. Report `stale` and `skipped` separately.
- **N2. "Warm" lasts about 6 hours a day.** The board cache TTL is 6 h (`lib/search/board-cache.ts:109`) and the cron runs once a day at 14:00 UTC, so a grader searching after about 20:00 UTC (noon Pacific) gets a cold fetch anyway. `serveStale` defaults to false. DECISIONS 062 and the README word this as "so graders don't hit a cold cache". In practice the keep-alive is the real benefit. Reword it, or accept it as is.
- **N3. The confirm dialog's buttons have no accessible name while busy.** In `components/confirm-dialog.tsx` (the Cancel and Confirm buttons near the end), the content becomes `<Spinner />`, which is `aria-hidden`. The Phase 5 N3 fix covered only the Send button. Add `aria-label={busy === "confirm" ? "Confirming" : undefined}`, and the same for Cancel.
- **N4. The dark-mode danger button has low contrast.** `components/ui.tsx` (the `danger` variant) puts white text on `--critical #ef6b6b` in dark mode, about 3.0:1. That's below 4.5:1 for 14 px text. Only the delete confirmation uses it, and `docs/DEMO.md` invites recording in dark mode. Use a darker red for the dark-mode button background, or dark text.
- **N5. Small accessibility gaps.** On phones, the header buttons have `aria-label="Load demo profile"` but show "Demo" (and "Seed"), so the visible label isn't part of the accessible name (WCAG 2.5.3). The tabs support Left/Right arrows but not Home/End. The green dot meaning "profile loaded" relies on color alone, though the panel content says the same thing.
- **N6. `check:live` doesn't cover `/api/actions/:id/reject`.** The README says it covers "401s on every protected route". I curled the route and it returns 401. Add the route to the loop in `scripts/smoke-live.ts:47`.
- **N7. The N11 prefilter also drops real software roles.** `lib/search/title.ts:45` now excludes any title with "hardware", "firmware" or "embedded" unless embedded roles were requested. The regression test even asserts that "Backend Engineer, Firmware Platform" is excluded, and titles like "Software Engineer, Hardware Test" or "…Hardware Infrastructure" go too. For a new-grad backend demo that trade-off is reasonable. Record it as a known false-negative in DECISIONS 062.
- **N8. The Review message is misleading when a refresh fails.** If `/api/state` fails after a turn (network error or the new 429), `state.actions` is stale, and clicking Review says "That action is already handled" (`components/offer-desk.tsx`, `review`) even though it's still pending. That's safe but wrong. When the action isn't found, say "Couldn't load its status. Retry the session."
- **N9. The snapshot skips `safeUrl`.** `lib/search/snapshot.ts:16` accepts any `url: z.string()`. The snapshot is a committed, trusted file, so the risk is low. A `.refine((u) => safeUrl(u) !== "")` would make N4 hold for every ingestion path.
- **N10. README and PROMPTS polish.**
  - After recording, add the video link to the README.
  - In PROMPTS "At a glance", say "16/18 → 18/18 on the tuning scenarios (in-sample)". The full text admits it is in-sample; the summary should too.
  - The README says tool errors let the model "fix the call once". The prompt only asks for that (`prompts/system-v4.ts:18`); code enforces only the 8-call cap. Word it as "the prompt asks it to fix the call once; the loop caps a turn at 8 calls".
- **N11. Demo presentation.** In the screenshot, the top match scores 48 of 100, and the chat says new-grad status was "unknown for all ranked roles". On video that can read as a weak result. Say in the narration that the score is a relative ranking computed in code, and that "unknown" means the posting doesn't say.

## Testing assessment
- **Real results:** 407 tests passed, coverage floors held (no change to the vitest config in this diff), and no `.only`, `.skip` or `todo` in `tests/`.
- **Cron:** `tests/lib/cron/warm.test.ts` covers auth well: exact match, missing `Bearer` prefix, null header, and closed when no secret is set, including the `"Bearer undefined"` trick. The warm-up tests check real behavior against the in-memory store: one board failing doesn't stop the run, the failure is cached, and a second run is served from cache. `tests/api/cron.test.ts` checks that no warm-up happens on any 401 path (`warmCalls === 0`). That's a good negative assertion. The 200 test mocks `warmBoardCache` completely, so the route's wiring to Supabase is checked only by the build and `check:live`'s 401s, and S1 remains.
- **N4 (`safeUrl`):** table tests cover `javascript:`, `data:`, relative URLs and null. There's also an end-to-end test through `fetchGreenhouseBoard` with a hostile URL. Lever and Ashby use the same `.filter(hasUrl)`, but only Greenhouse has a test that drops a job.
- **N11 (title):** the regression test uses the real live title, which follows TESTING.md. It also asserts that the embedded search still matches those titles, so the change can't silently exclude them from embedded searches.
- **N5 (`/api/state` limit):** one boundary test at 599 → 601 checks the hour-bucket key, IP scope and `retryAfterSeconds`. Route-level wiring is untested (S4).
- **N1 (source chips):** the `session-state` test asserts that `sourceStatus` passes through. The client fallback in `offer-desk.tsx` (stored status first, then the live event) has no test. It's only checked by the `check:ui` reload step, which I didn't run.
- **UI restyle:** no unit tests, as is usual for this project. The builder reports `check:ui` 22/22 against the deployment (**not re-run by me**). The one selector change (`div.ml-8` → `[data-role=user]`) makes that check sturdier.

## Risks to the end goal
1. **Supabase pausing during grading (S1).** This is the only finding that could take the live URL down. Ten minutes in the Vercel dashboard closes it.
2. **Recording budget.** `docs/DEMO.md` correctly warns against running `check:ui`, `check:agent` and the evals on recording day (200 model calls per network per day, 30 chat turns per hour). One rehearsal plus one take fits.
3. **Live numbers drift.** "7,917 → 7" in the README and DEMO will be stale by grading time. The README presents it as one search, which is honest. Say the numbers from that day's run in the video, as DEMO.md instructs.
4. **Scope:** nothing new is in flight. Phase 6 added no dependencies. Leaving N8 (client logic refactor) out was the right call this late.

## What's done well (verified)
- **The cron endpoint is secure by construction.** The comparison is constant-time and length-checked, it is closed when the secret is unset, it makes no model calls, POST returns 405, and it builds as dynamic. The live endpoint returns 401 for no header, an empty Bearer and a wrong secret.
- **`/api/state` checks the session before counting** (`requireUser` runs first), so anonymous floods can't use up a campus IP's quota. A 429 reaches the UI as a retryable session banner, not a crash. 600/h is a sensible ratio to the 30/h chat limit.
- **N4 is done at the right layer.** Bad URLs are cleaned and dropped at ingestion, before they reach the cache or the database, rather than escaped in the UI.
- **N11 is fixed in the prefilter, not by a score tweak,** and DECISIONS 062 explains why.
- **N9 removes a real stale-state path.** The dialog now reopens only from the server's current state, never from an old turn event.
- **The README's claims check out against the code.** 145 boards, the 120-posting snapshot, 15/30/500 limits, Node 24, every file path in the requirement table, three destructive tools, and the funnel numbers in the screenshot (7,917 → 1,751 → 782 → 699 → 36 → 8 → 7; chips 26 + 21 + 13 = 60 boards) are all internally consistent. Its limitations section is candid, including the v4 "delete → archive" miss.
- **The restyle keeps status from relying on color.** Status chips pair an icon with a label, source chips show an icon plus "n/m boards", and toasts and badges have icons. The tabs now follow the WAI-ARIA pattern (`aria-controls`, roving `tabIndex`, `aria-labelledby` on the panel). Ink primary buttons fix the Phase 5 contrast finding for primary actions. The confirm dialog keeps Cancel as the default focus and says "Confirm runs exactly these N" (S2 and N4 are the exceptions).
- **The docs are honest and useful.** DECISIONS 061/062 record each change with its reasons and alternatives, and DEMO.md is a concrete, budget-aware script tied to the 30% demo criterion.
