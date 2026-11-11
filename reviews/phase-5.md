# Phase 5 Review

**Verdict:** PASS WITH FIXES

The UI meets the assignment's UI requirement and almost all of PLAN section 5. Destructive actions run only through the dialog. There is no HTML rendering of model or posting text, and `/api/state` is scoped to the verified user. The live browser check passed against the deployment. Nothing blocks Phase 6. Several stale or misleading states remain, and one chart label is wrong. These should be fixed before the demo video is recorded, because the video is 30% of the grade.

## Commands run

| Command | Result |
|---|---|
| `npm run check` | **Pass** (exit 0). Lint and typecheck clean. 33 files / **390 tests passed**. Coverage on `lib/**`: lines 98.87%, statements 97.55%, branches 87.45%, functions 95.11%. Floors 90/90/85 unchanged. `next build` lists `/api/state` as dynamic. |
| `npm run check:rls` | **Pass.** All RLS checks passed, including messages/action_log isolation and postings denied to users. |
| `npm run check:live` | **Pass.** 11/11 against the deployment (sessions distinct, 401s without a session). |
| `curl -X POST /api/state` (no token, garbage token), `/api/files/:id/url` (no token) | 401, 401, 401. |
| `BASE_URL=https://offer-desk-teal.vercel.app SHOTS=<scratch> npm run check:ui` | **Pass.** 22/22 assertions. Turns took 5.9–11.6 s. I read the screenshots for results, dialog, funnel and mobile. Did not run `check:agent`, to stay within the per-IP budget. |
| grep for `.only`/`.skip`/`todo` in `tests/` | none |
| grep for `dangerouslySetInnerHTML`/`innerHTML` in `components/ app/ lib/ui` | none |

## Assignment alignment

| Requirement | Status | Where / notes |
|---|---|---|
| LLM integration: send/receive | done | `lib/llm/openai.ts`, `lib/agent/loop.ts` (Phase 4) |
| API errors / rate limiting | done | `lib/http/retry.ts`, `lib/safety/limits.ts`. The UI shows 429s with an "about N min" hint (`offer-desk.tsx:82`). |
| Parse LLM output to commands | done | Zod-validated tool calls (`lib/agent/executor.ts`) |
| Multiple domains | done | Job-board API calls, DB operations (pipeline), file operations (CSV/MD/ICS in storage) |
| UI: natural-language input | done | `chat-panel.tsx` textarea and suggestion chips |
| UI: display results | done | Results / Pipeline / Funnel tabs (`results-view.tsx`, `pipeline-view.tsx`) |
| UI: execution status | done, with gaps | Per-turn step timeline, action-log status chips, spinner. Not streamed (D059). Stale statuses: see S4 and S6. |
| UI: feedback on actions | done | Toasts, file cards, pending cards, confirm/cancel toasts |
| Validate LLM output | done | Phase 4 executor; the UI shows "Rejected call" rows |
| Graceful errors | mostly | Turn errors handled. Confirm, demo and download have no network-error handling (S7). |
| Confirmation for destructive ops | done | `confirm-dialog.tsx` is the only caller of `/confirm` (`offer-desk.tsx:121`). Checked by grep and live (nothing archived before confirm, exactly 4 archived after). |
| Audit log of all actions | done | `action-log.tsx` shows args, resolved args, status and duration for the last 60 rows |
| Deliverable: GitHub repo | done | public |
| Deliverable: deployed URL | done | live and verified today |
| Deliverable: demo video | planned | Phase 6 |
| README / PROMPTS write-up | in progress | Phase 6 |

## Findings

### Blocking
None.

### Should fix

**S1. Chat history duplicates new turns after a reload once a user has 30 or more message rows.** (`components/offer-desk.tsx:41,56,153`; `lib/agent/session-state.ts:6`)
`history = state.messages.slice(0, historyCount)`, where `historyCount` is frozen at the first load. `state.messages` is a sliding window of the last 30 rows. Once the window is full, each new turn pushes old rows out and new rows in, so `slice(0, historyCount)` includes the new user and assistant messages. They then render twice: once in history and once in `turns`. The oldest history rows also disappear from the top. Whoever records the demo will rehearse in one browser, build up history, and reload, so this is likely to show up in the video. `check:ui` cannot catch it because it never reaches 30 rows.
**Fix:** freeze the history array itself on the first successful load (for example `const [history, setHistory] = useState<Msg[] | null>(null)`, set once), not a count.

**S2. The Funnel tab ignores the range the agent used, so chat and chart can disagree.** (`components/pipeline-view.tsx:63`, `components/offer-desk.tsx:174`; `get_funnel_stats` returns `forUI.rangeDays` at `lib/agent/tools/pipeline.ts:184`)
"Show my funnel this week" makes the tool report 7-day numbers in chat. `tabFor` then switches to the Funnel tab, which still shows its own default of 30 days. A 14-day range isn't even one of the tab's options. This contradicts DECISIONS 056 ("chat and chart always agree").
**Fix:** when a `funnel` ui_payload arrives, pass its `rangeDays` to `FunnelTab` (lift `range` into `OfferDesk`, and add the value as a button if it isn't 7/30/90).

**S3. Generated files disappear after a reload. `state.files` is loaded but never rendered.** (`lib/agent/session-state.ts:98`; no consumer in `components/`)
File cards exist only in the in-memory `turns`. After a reload the checklist and `.ics` cards are gone, and the only way back is to ask the agent again. Timelines, pending cards and source chips are also lost. DECISIONS 056 says the read "makes a reload lossless", which overstates it. The reload assertion in `check:ui` only checks text.
**Fix:** render a small "Files" list from `state.files` (in the log panel or under the chat), with the same `onDownload`. Then reword DECISIONS 056 to say exactly what survives a reload.

**S4. The step timeline keeps showing "Needs confirm" after the user confirms.** (`components/chat-panel.tsx:50`)
`Timeline` renders `step.status` from the turn's frozen events. The pending card below uses the live `actionStatus` map, so the screen shows "Needs confirm · Archive applications" directly above "Done · Archive 4 applications" (seen in my `07-funnel` screenshot). This is the demo's key safety moment, and a grader may read it as inconsistent.
**Fix:** in `Timeline`, use `actionStatus.get(step.actionId) ?? step.status`.

**S5. The first bar of the breakdown chart is mislabeled "Engineering jobs".** (`lib/ui/format.ts:194`)
`considered` is every posting on the selected boards (`lib/search/search-jobs.ts:56-63`). Nothing is filtered to engineering at that point, and the next step removes "−6157 other roles". The chart says 7,917 "Engineering jobs", while the agent's own answer correctly says "7,917 listings". The point of this chart is honesty, so the first number should be right. PLAN section 9 step 3 uses the same wording.
**Fix:** label it "Jobs on N boards" or "All listings", and update the demo script.

**S6. Rows interrupted mid-call show "Running"/"Started" forever.** (`lib/ui/format.ts:143-144`)
DECISIONS 054 S3 left this open and said Phase 5 could show such rows as "interrupted" when they're older than `maxDuration` (300 s). It wasn't done, and DECISIONS 059 doesn't record deferring it.
**Fix:** in `ActionLog` and `StatusChip`, show `proposed`/`confirmed` rows older than 300 s as "Interrupted" (serious tone), or record the deferral in DECISIONS.

**S7. Confirm, cancel, demo buttons and download have no network-error handling.** (`components/offer-desk.tsx:119-150`)
`api.*` rejects on a network failure (`authedFetch` throws). In `decide`, the promise is rejected, so no toast appears, the dialog stays open with no explanation, and the rejection goes unhandled. `demo` has the same problem and isn't guarded by `busy`, so two quick clicks send two requests.
**Fix:** wrap each in try/catch with a critical toast like `send` has, and set `busy` during `demo`.

**S8. `check:ui` has a date bomb and one assertion that can't fail.** (`scripts/check-ui.mts:84,90-91,100`)
- `/Thu, Nov \d+, 2:00 PM/` stops matching on December 1. If it fails during a Phase 6 re-run, the gate breaks for no real reason. Use `/Thu, \w{3} \d+, 2:00 PM/`.
- "The dialog lists exactly the previewed items" compares the `<li>` count with the number in the Confirm button. Both come from the same `preview`, so this can't fail. The post-confirm check compares counts only, not which rows. A stronger check: before confirming, query the seeded applications with `updated_at < now − 21 d` and stage not archived. Assert the dialog refs or labels match that set, and after confirming assert that exactly those ids are archived.

### Nice to have

- **N1.** Source chips are lost after a reload: `ResultsView` doesn't include `result_sets.source_status`, which is already stored (`lib/agent/tools/jobs.ts`, `createResultSet`). Add it to `loadSessionState` and fall back to it in `ResultsTab`.
- **N2.** The confirm dialog truncates each label to one line (`components/confirm-dialog.tsx:59`), so on long titles the company is cut off (seen in the screenshot: "Software Engineer, ERP Applications…"). PLAN 4.5 asks for title · company · stage · last touched, and this is the safety-critical view. Let it wrap.
- **N3.** Accessibility: the board tabs have no `id`/`aria-controls`, no arrow-key handling, and an unlabeled `tabpanel` (`offer-desk.tsx:158-166`). While busy, the Send button contains only an `aria-hidden` spinner, so it has no accessible name (`chat-panel.tsx:178-180`); add `aria-label="Send"`. In dark mode, white on `--accent #3987e5` is about 3.7:1, below 4.5:1 for small text.
- **N4.** Posting URLs from the ATS APIs go into `href` with no scheme check (`lib/sources/greenhouse.ts:30`, `lever.ts:42`, `ashby.ts:33`). React 19 blocks `javascript:` URLs, so this is defense in depth: accept only `https?:` in normalization.
- **N5.** `/api/state` has no rate limit, and each call runs about 10 Supabase queries plus an `expireActions` write. No OpenAI cost, but it is open on a public URL. A light per-IP limit would cover it.
- **N6.** Doc accuracy: DECISIONS 055 says both charts have "a hover tooltip and a table view", but the search breakdown has neither (only a `title` attribute; its `<ol>` is readable as text). DECISIONS 058 says "three real bugs" and lists four. HANDOFF is dated 2026-11-11.
- **N7.** The ranked card shows "48 / score" with no scale. Add "of 100" (or whatever the max is) or a tooltip that explains it.
- **N8.** Client logic (`tabFor`, history handling, the `review` fallback) lives in components that no unit test covers. It is exercised only by the costly, model-dependent `check:ui`. Moving these helpers into `lib/ui/` would put them under coverage. `scripts/smoke-live.ts` should also add `/api/state` and `/api/files/:id/url` to its 401 list (I verified both by hand).
- **N9.** `review()` falls back to the turn's event for actions that have scrolled out of the 60-row log (`offer-desk.tsx:112-115`), so it can reopen a dialog for an action that was already handled. The server safely returns 409. Show the status instead.
- **N10.** Zero-count bars get a 0.75% stub (`results-view.tsx:44`, `pipeline-view.tsx:106`). The label says 0, but no bar would be more honest.
- **N11.** Relevance visible in the demo: #2 in the live run for "backend and full-stack" was "Server Hardware Systems Engineer (Starlink)". This is title matching from Phase 2, not UI, but it will be on screen in the video. Rehearse and check `titleMatchesRoles` for "Systems Engineer".

## Testing assessment

- `npm run check` is green with real numbers, the floors are unchanged, and no tests are skipped or focused.
- New Phase 5 tests:
  - `tests/lib/ui/format.test.ts`: status labels, `funnelSteps`, the Markdown subset, `computeFunnel`.
  - `tests/lib/agent/session-state.test.ts`: empty session, per-user scoping against another user's application, system messages filtered, expiry of stale proposals.
  - `tests/lib/agent/tools.test.ts`: regression tests for reworded-search reuse and local "today".
  These assert behavior and the bug fixes have regression tests, as TESTING.md requires.
- Gaps:
  - Components are excluded from coverage and have no unit tests. The client-side state bugs above (S1, S2, S4) live in exactly that untested layer.
  - No route-level test for `/api/state`. Auth is shared with other routes; I verified the 401 live.
  - The search-reuse key has no test showing that different `places` or `remote_ok` produce a new search.
  - `check:ui` is a solid end-to-end check (it found four real bugs), but see S8.

## Risks to the end goal

1. **Live-URL capacity on grading day (biggest risk for graders).** The limits are 30 chat turns and 60 agent calls per IP per hour, and 500 model calls per day globally. Graders on a shared campus NAT share one IP budget. Every gate run of `check:agent`/`check:ui` spends about 18 calls of the same daily cap (about 220 used today). Do not run live agent checks on recording or grading day beyond one rehearsal. Make sure the Phase 6 cron (D033) keeps the board cache warm and Supabase awake.
2. **Demo video pacing (biggest risk for the video).** Turns take 6–12 s with only a spinner, because nothing is streamed. In a 1–2 minute video, four or five such waits eat 40–60 s. Plan to cut the waits in editing. Fix S4 and S5 first: both are on screen during the key steps (the breakdown and the confirm).
3. **Rehearsal state.** S1 and S3 only appear after a reload with history. Record in a fresh incognito window, as PLAN section 7 already says, or fix them first.
4. **Daily data drift.** Live run today: 7,917 listings → 9 matches → 8 ranked, with three of the top five from SpaceX. The script's "save the top 5" still works, but with only about 9 matches on some days, rehearse the same day as planned.

## What's done well (verified)

- **Confirmation cannot be bypassed from the UI.** `api.confirm` is called only from `decide`, which only the dialog triggers. The server runs stored `resolved_args`, uses Bearer auth (so no CSRF), and the dialog autofocuses Cancel. Escape leaves the action pending. Live: 0 archived before confirm, exactly 4 after, and cancelling a file delete kept the file and logged "Cancelled".
- **No HTML injection path.** Model answers go through `parseMiniMarkdown` into React text nodes. Evidence quotes, notes and titles render as text, and nothing uses `dangerouslySetInnerHTML`.
- **`/api/state` is scoped to the user.** Every user-table read filters on the verified `userId` (`supabase-store.ts`). Postings are read by id only, for the user's own applications and result sets. `POSTING_COLUMNS` excludes the description, and `toPosting` drops `raw`. The route returns 401 without a valid token (checked live).
- **The charts are honest in structure.** Both are linear from zero, every bar has a direct count label, the funnel has a table view, "Computed in code" is stated, and the response-rate definition is spelled out ("screen, interview or offer"). The funnel tab shares `computeFunnel` with the tool. Only the range (S2) and the first label (S5) are off.
- **Status is never shown by color alone.** Chips carry an icon and a label (`lib/ui/format.ts:140-149`). Focus is visible globally (`globals.css`), `<dialog>` uses `showModal` with `aria-labelledby`, the textarea has a label, and toasts are `aria-live`.
- **PLAN section 5 is covered:** three panels, tabs, source chips, the breakdown, the evidence popover (quotes checked by code), empty states with next steps, demo buttons, the profile popover, error and loading states, and a mobile tab layout (seen in the 390 px screenshot).
- **DECISIONS 057 (search reuse)** is keyed on what actually drives `filterJobs` and `selectBoards` (role groups, tags, places, remote, age, internships). I checked this against `lib/search/filter.ts` and `search-jobs.ts`, and it has a regression test.
