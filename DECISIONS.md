# Decisions

One short entry per decision: what, why, alternatives considered. Newest at the bottom.

## 001. Job data sources: ATS boards + optional Adzuna, no The Muse
- **What:** Greenhouse, Lever and Ashby public job board APIs are the core sources. Adzuna is optional (enabled only when its keys are set).
- **Why:** The ATS APIs are free, need no key, and return full descriptions and direct apply links. The Muse returned a 403 Cloudflare challenge page to a non-browser request (tested 2026-11-09), so a Vercel server would likely be blocked too. Adzuna's free tier may be a time-limited trial, so the app must work without it.
- **Alternatives:** The Muse (blocked), scraping job sites (against terms, fragile), paid job APIs (assignment constraint: free only).

## 002. Scope cuts for a 2-day build
- **What:** No PDFs (Markdown checklist + CSV instead), no funnel report file (chart in UI), fixed pipeline columns instead of drag-and-drop, exact-match dedupe only, streaming as a stretch goal.
- **Why:** These cost a lot of time and earn few rubric points. The time goes to the confirmation flow, action log, extraction eval, and the deployed demo.
- **Alternatives:** Full brief scope (estimated 4-5 days).

## 003. Lower usage limits for the public URL
- **What:** 15 chat requests/hour per session, 25 extractions per triage, 500 OpenAI requests/day globally, 100 Adzuna calls/day, $5-10 monthly spend limit on the OpenAI key.
- **Why:** Anyone with the URL can use the app; these caps bound the cost.
- **Alternatives:** Higher limits from the first draft (30/hr, 40, 1,500/day).

## 004. Phase 0 probe results (2026-11-09, `scripts/probe-sources.ts`)
| Source | Result | Size | Notes |
|---|---|---|---|
| Greenhouse list (Stripe) | 200, 772 jobs | 470 KB | No descriptions in the list. Location is `{name}`, dates are ISO with offset (`first_published`, `updated_at`) |
| Greenhouse `content=true` (Stripe) | 200 | **5.9 MB (12.5x)** | Content is HTML-escaped (`&lt;h2&gt;`), needs unescape + strip |
| Greenhouse single job | 200 | ~7 KB | `/boards/{token}/jobs/{id}` returns one job with content |
| Greenhouse (Discord) | 200, 27 jobs | 21 KB | Location strings like "San Francisco Bay Area or Remote (U.S.)" |
| Lever (Palantir) | 200, 304 postings | **5.7 MB, ~1 s** | No lightweight list mode. `createdAt` is epoch ms. Location in `categories.location` / `allLocations`. **`descriptionPlain` is only the intro; requirements are in `lists[]`** (e.g. "What We Require") |
| Ashby (Ramp) | 200, 172 jobs | 2.8 MB | `descriptionPlain` is full. `isRemote: true` together with `workplaceType: "Hybrid"` happens, so conflicting fields exist |
| Ashby (bad slug) | **404**, empty body | 0 | The board verify script can rely on the status code |
| The Muse | 403 Cloudflare challenge | n/a | Dropped (see 001) |
| Adzuna | not tested yet | n/a | Waiting on a key |

No source sent rate-limit headers, so we use conservative concurrency (8) and backoff on 429/5xx.

## 005. Cache per board, not per query
- **What:** Cache each board's normalized job list (title, location, dates, URL, short ID) for about 6 hours, and run the query filter in code over the cached lists. Descriptions are stored in `postings` only for jobs that pass the title prefilter.
- **Why:** Some boards are several MB (Lever and Ashby have no light list mode). A per-query cache would refetch the same big boards for every new query. With a per-board cache, the first search warms boards for every later query and every grader.
- **Alternatives:** Per-query `search_cache` from the brief (still used for Adzuna, which is a keyword search API).

## 006. Greenhouse two-pass fetch
- **What:** Fetch the list without `content`, filter titles in code, then fetch `/jobs/{id}` only for matches (concurrency limited).
- **Why:** `content=true` was 12.5x bigger (5.9 MB for Stripe), and most of it is jobs we'd drop by title anyway.

## 007. Lever description = intro + lists + additional
- **What:** The Lever normalizer builds the description from `descriptionPlain` + each `lists[]` item (heading + content with HTML stripped) + `additionalPlain`.
- **Why:** The requirements ("What We Require") live in `lists`, not in `descriptionPlain`. Without this, extraction would miss years and clearance.

## 008. Remote field priority
- **What:** `workplaceType` (when present) wins over `isRemote` and location text. Anything unclear stays `unknown`; the extraction step can still fill `location_type` from the description.
- **Why:** Ashby returned `isRemote: true` with `workplaceType: "Hybrid"` for the same job.

## 009. OpenAI Responses API
- **What:** Use the Responses API for the agent loop (function calling) and extraction (Structured Outputs via `text.format`).
- **Why:** OpenAI's docs recommend Responses for new projects; Chat Completions is still supported. Tool results go back as `function_call_output` items tied to `call_id`, which fits our logged, step-by-step loop.
- **Alternatives:** Chat Completions (more examples online, but not the recommended path for new work).

## 010. Model choice: decided from the account's model list
- **What:** `OPENAI_MODEL` (agent) and `OPENAI_EXTRACT_MODEL` (extraction) stay env vars. In Phase 1 we list the models the key can access and pick a small current model for the agent and the cheapest nano-class model for extraction, after checking prices on OpenAI's pricing page.
- **Why:** Third-party pricing pages disagree on current model names and prices.
- **Result (2026-11-09):** `gpt-6-luna` for both. Official pricing: $0.10 in / $0.50 out per 1M tokens. On a tiny Structured Outputs test, both `gpt-6-luna` and `gpt-5-nano` ($0.05 / $0.40) answered correctly, but nano used 192 reasoning tokens (billed as output) against luna's 26, so luna was about half the cost per call. Estimate: one 25-posting triage ≈ $0.01, one agent turn ≈ $0.001. Phase 3's eval can re-check luna against nano on extraction accuracy.

## 011. Vercel function duration
- **What:** Set `maxDuration` on `/api/agent` to 60 s, well under the Hobby maximum.
- **Why:** Vercel's docs list Hobby at 300 s (default and maximum) with Fluid compute; some older pages say 60 s. Staying at 60 s works under either, and a turn that needs more than a minute is a bad demo anyway.

## 012. Supabase publishable/secret keys
- **What:** Use Supabase's new API keys: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`, browser) and `SUPABASE_SECRET_KEY` (`sb_secret_...`, server only).
- **Why:** The project dashboard issues these by default; they replace the legacy `anon` / `service_role` JWT keys. Naming the env vars after them avoids mixing them up.

## 013. Bearer-token auth instead of cookie sessions
- **What:** The browser keeps the Supabase session (supabase-js default, localStorage) and sends `Authorization: Bearer <access token>` to our API routes. Each route verifies the token with `auth.getUser` and creates a Supabase client scoped to that token, so Row Level Security still applies. No `@supabase/ssr`, no `proxy.ts`.
- **Why:** The app is one page that talks to API routes; server components never need the user. Next.js 16 renamed middleware to `proxy.ts`, and with `cacheComponents` on, reading cookies in pages forces Suspense boundaries. Tokens in headers avoid both, and POST route handlers always run per request. Tested locally: valid token → 200, missing or fake token → 401.
- **Alternatives:** `@supabase/ssr` cookie sessions with a `proxy.ts` refresh (more moving parts, no benefit for a single-page app).

## 014. Next.js 16 + `@types/node` 24
- **What:** Scaffolded with create-next-app (Next 16.4, React 19.3, Tailwind 4, Turbopack). Bumped `@types/node` from 20 to 24 to match the local Node 24 and satisfy vitest 5's peer dependency.
- **Why:** Forcing the install (`--legacy-peer-deps`) would hide a real version mismatch.

## 015. Explicit grants for every role
- **What:** Migrations grant table access explicitly: `authenticated` on user tables (RLS still applies), `service_role` on everything (0003), nothing for `anon`.
- **Why:** This Supabase project doesn't auto-grant new tables to its roles. The RLS check script caught it: the server got "permission denied for table counters". Explicit grants make the access rules readable in one place instead of depending on project defaults.

## 016. One `counters` table and a versioned extraction cache (schema drift recorded)
- **What:** The planned `quota` and `rate_limits` tables became one `counters` table (`key`, `count`, `expires_at`) with an atomic `increment_counter` function. The `extractions` cache key is `(description_hash, prompt_version, model)` instead of `description_hash` alone.
- **Why:** Rate limits and quotas are the same operation (count within a time bucket), so one table and one atomic function cover per-session, per-IP, OpenAI and Adzuna limits. Versioning the extraction cache keeps the prompt v1→v2 eval honest: changing the prompt or model never serves stale results. Flagged as undocumented drift by the Phase 1 review (S5).

## 017. Adzuna deferred
- **What:** Adzuna stays optional and is not built in Phase 2. Its Phase 0 item (confirm description truncation) is closed as "not tested; no key".
- **Why:** No key yet, and it may be a short trial that expires during grading. The three ATS sources need no key, give full descriptions, and cover 153 verified company boards. If a key shows up, the source interface makes it a small add. Recorded per Phase 1 review N7.

## 018. Rate limit per session and per IP
- **What:** In Phase 4, chat requests are limited per session (15/hour) **and** per IP (hashed, e.g. 30/hour), on top of the global 500 OpenAI requests/day.
- **Why:** Anyone can mint new anonymous sessions, so a per-session limit alone is easy to bypass (Phase 1 review N5). The per-IP limit protects the shared daily cap, which is what keeps the demo usable for graders. The IP is hashed before storage.

## 019. Server-written user tables; race-safe confirm and refs (Phase 1 review S1, S4, N8)
- **What:** `refs`, `files`, `result_sets`, `messages` and `action_log` are read-only for users; the server writes them with the admin client, always taking `user_id` from a session verified by `requireUser`. File `storage_path` must start with the owner's id (database check). In Phase 4, confirming an action is one conditional update (`… where id = $1 and user_id = $2 and status = 'awaiting_confirmation' and expires_at > now() returning *`), so a double click can't execute twice; short refs are numbered with `increment_counter('ref:<user>:<kind>')`.
- **Why:** The review showed users could insert a `files` row pointing at another user's file, which the server would sign with its secret key. Making the server the only writer closes that and fake refs/system messages. Users still write `profiles` and `applications` directly; RLS keeps those to their own rows and they hold nothing the server trusts blindly.

## 020. shadcn/ui deferred to Phase 5
- **What:** shadcn/ui (plan D8) was not installed in Phase 1; it is installed in Phase 5 with the real UI.
- **Why:** Phase 1's shell is three placeholder panels; adding a component library before any component exists is setup with no payoff. Tailwind is installed. Recorded per review S6.

## 021. Start the extraction eval during Phase 2
- **What:** Phase 2 collects about 15 real postings for the extraction eval (from the snapshot) and drafts their labels. The user checks the labels before Phase 3 uses them.
- **Why:** The Phase 1 review warned that day 2 (Phases 3–6, about 13 hours) holds all of the prompt engineering (20%), UI (10%) and demo (30%) points. Labeling is the one Phase 3 task that only needs Phase 2's data, so moving it earlier takes about an hour off day 2.

## 022. Split env config into public and server modules
- **What:** `lib/env/public.ts` (browser-safe) and `lib/env/server.ts` (imports `server-only`).
- **Why:** The Phase 1 review found the server env schema (variable names, no values) in the browser bundle, because the browser client imported the shared module. Now the build fails if server config is ever imported from client code.

## 023. Board cache holds light job lists; descriptions live in `postings` (Phase 2)
- **What:** Refreshing a board keeps only engineering titles, upserts them (with descriptions where the source gives them) into `postings`, and stores a light list (title, locations, dates, url, posting id; no description) in `board_cache.jobs`. Searches filter the light lists in code. Descriptions are loaded only for the postings that need them (`loadDescriptions`), which also does pass two of the Greenhouse fetch and saves the result.
- **Why (end goal: a fast, reliable demo search on free tiers):** A search over 60 boards reads kilobytes of light lists instead of megabytes of descriptions, and needed no schema change. Measured: cold search over 60 boards 6.5–8.6 s; warm search 0.3–0.7 s.
- **Alternatives:** One `postings` row per job queried with SQL (needs `board_key`/`closed_at` columns and a migration, plus tracking closed jobs); full descriptions inside the cache (Ashby/Lever boards are multi-MB).

## 024. Board selection rotates sources; refresh cap equals board count
- **What:** `selectBoards` takes tag matches first, then rotates Greenhouse/Ashby/Lever within each score. A search refreshes up to all 60 selected boards; the 25 s time budget is the guard.
- **Why:** Found in the first live run: listing order picked 57 Greenhouse boards out of 60, so OpenAI, Ramp, Notion, etc. were barely searched. With a refresh cap (40) below the board count (60), the second identical search refreshed 20 more boards and returned different results, which would confuse a grader.

## 025. Role and location rules tightened from live results
- **What:** A role match needs a builder word (engineer/developer/scientist/programmer); a generic match needs a software word ("software", SWE, SDE, programmer), not "engineer" alone. A remote location counts as US only if it says US, a US state/coast, or a ", XX" state code, or it says just "Remote" with no non-US places beside it. `, IN` and `, DE` are excluded (India/Germany).
- **Why:** The first live search let in "Battery Systems Engineer", "Curriculum Developer", "Operations Analyst, … Platform", "Remote, KSA" and a Europe-only role with a bare "Remote". Requiring a positive US signal is safer than listing every other country. Each case is now a regression test.

## 026. Real-postings snapshot
- **What:** `npm run snapshot` saves 120 real new-grad-relevant postings (46 companies, all three sources, full descriptions) to `data/sample_postings.json` (≈0.8 MB). It backs "Seed sample pipeline", the search fallback when every live board fails (labelled `usedSnapshot`), and the extraction eval.
- **Why:** The demo (30%) must work even if a job board is down during grading, and the eval needs fixed inputs.

## 027. Extraction eval: 16 cases, labeling rules as the spec (moved into Phase 2)
- **What:** `evals/extraction/cases.json` has 16 real postings with draft labels for years, clearance, location type, degree and new-grad fit; `LABELING.md` defines each rule. The extractor will receive title, company, listed locations and description. Labels need a human check before Phase 3.
- **Why:** Phase 1 review risk (day 2 overload). The cases were chosen for traps found in real text: 401(k) vesting "2 year", company age "20 years", "1.5+" vs "5+", ITAR vs clearance, A-and-B year requirements.
- **Evidence for the README problem statement:** of the 120 snapshot postings that passed the title filter for entry-level software roles, many still require 3+ to 10+ years (e.g. Affirm "Software Engineer II" 1.5+, Writer 5+, Gusto 10+). That gap is what Phase 3 closes.

## 028. Scripts run with `tsx --conditions=react-server`, as `.mts`
- **What:** Scripts that import app code use `tsx` (handles the `@/` path alias and JSON imports) with the `react-server` condition, under which the `server-only` package is a no-op (same as Next.js on the server). They use the `.mts` extension so top-level `await` works without setting `"type": "module"` for the whole Next.js project.

## 029. Transient board failures are expected; only 404s remove a board
- **What:** `boards:verify --write` removes a board only on 404 or zero open jobs; timeouts and 5xx are reported as "kept: may be temporary".
- **Why:** During the Phase 2 gate, Anduril's Greenhouse board (the biggest SoCal board for the demo) timed out for several minutes from Node (15 s × 3 attempts), then answered in about 160 ms. The old script would have deleted it. The search path already handles this case by design: a failed refresh serves stale cached jobs and backs off for 10 minutes (DECISIONS 023).

## 030. Phase 2 review fixes (reviews/phase-2.md)
- **S1:** the snapshot loader inserts only missing postings (`INSERT … ON CONFLICT DO NOTHING`, then looks up ids), so seeding or the fallback never replaces newer live postings with trimmed snapshot copies or changes their description hashes. Regression test added.
- **S2:** a bare "America" no longer counts as US ("Remote - Latin America", "South America"). Regression tests added.
- **S4:** three eval labels corrected after checking the posting text (Stripe "50% Telecommuting permitted" → hybrid; Twitch → new-grad unknown, requires professional experience; Zoox → new-grad no, requires current enrollment). The "level-I title" clause was removed from the new-grad rule. Eval results must be reported next to the trivial most-common-label baseline, because 14/16 clearance labels are `unknown`.
- **S5:** migration 0004 (still unapplied, so amended rather than adding 0005) caps profile name/skills/locations/filters and application notes. `check:rls` now tests these and also that users can't delete their own server-written rows.
- **Smaller:** whole-word `api`/`server` in role matching ("Capital One" isn't backend); "Student Worker" counts as an internship; `drop policy if exists` in 0004; `boards:verify` no longer counts unreachable boards as alive; PLAN doc drift fixed (extractions key, 60 boards, real funnel numbers in the demo script).
- **Phase 3 pre-rank:** the ≤25 postings sent to extraction are chosen by a code pre-rank (new-grad title signal, location match, recency, profile skills in the title), not newest-first, so the demo's top results are the most promising ones.

## 031. Cold-cache protection for graders (planned for Phase 4)
- **What:** When a board's cache entry is expired, serve it immediately and refresh it inside the request's remaining budget; give each fetch a timeout bounded by the request deadline, not a fixed 5 s × 3 attempts; keep `maxDuration` at 60 s for `/api/agent`.
- **Why:** The review showed the 25 s budget only stops *starting* fetches; one in flight can run about 16 s past it, and a turn may also run triage and LLM calls. Grading happens days after the cache was warmed (6 h TTL).

## 032. Short refs use a 10-year counter TTL
- **What:** Short refs (`J1`, `A1`, …) are numbered with `increment_counter('ref:<user>:<kind>', 10 years)`.
- **Why:** Migration 0004 deletes expired counters on every increment; with a short TTL, numbering would restart at 1 and collide with the `(user_id, ref)` primary key (review S3). A 10-year TTL keeps the existing atomic function without a new SQL function.

## 033. Daily warm-up cron (planned for Phase 6)
- **What:** A Vercel cron (free plan allows daily) calls a protected endpoint that refreshes the most-used boards and touches Supabase.
- **Why:** Keeps the cache warm for graders (DECISIONS 031) and prevents a free Supabase project from pausing after a week without activity (not verified for this project's plan; cheap insurance).

## 034. Hard filters use only grounded hard facts; "new-grad fit" only ranks (Phase 3)
- **What:** A posting is dropped only for years above the user's maximum or a required active clearance (optionally clearance eligibility), each backed by a quote the code verified. `is_new_grad_friendly` changes the score (0/8/20 points) but never removes a job.
- **Why:** After prompt v2, the remaining eval errors are borderline new-grad calls (a 2-year role labeled "no"). With 16 eval cases, tuning further risks fitting the test set. Using the soft judgment only for ranking means a residual model mistake can lower a job, never hide it from the user.
- **Alternatives:** Filtering on `is_new_grad_friendly = no` (would hide good 2-year roles about 6% of the time); a v3 prompt (diminishing returns, overfitting risk).

## 035. "Why it matched" is a code template, not an LLM call
- **What:** `whyMatched` builds the line from extracted fields and the score breakdown ("Matches TypeScript, Go · 1+ yr · remote (US)").
- **Why:** Free, instant, and it can't state anything the data doesn't hold, which the grounding rule requires. An LLM sentence would add cost and latency per result for no accuracy gain.

## 036. Extraction: Structured Outputs + zod + verified evidence quotes + one corrective retry
- **What:** Strict JSON schema on the Responses API, `reasoning.effort: "low"`, `store: false`; zod re-validation; every non-default answer needs a quote that code finds in the posting; one retry that lists the exact problems; then "extraction failed" (shown to the user, never dropped silently). API errors aren't cached; validation failures are.
- **Why:** Strict mode guarantees shape, not truth. The quote check makes "don't make things up" enforceable, and the retry fixed every failure in the eval (v1: 5/48 needed it, 0 failed after).
- **Cache key:** `(description_hash, "<prompt version>/<check version>", model)`, so changing either the prompt or the validator re-runs extraction instead of serving stale judgments.

## 037. Prompt v2 adopted after the eval
- **What:** `CURRENT_EXTRACTION_PROMPT = extract-v2`. v1 83.8% → v2 97.5–98.3% overall (3 runs each, two v2 runs), new-grad field 43.8% (below the 56.3% trivial baseline) → about 90%. Details and the failure-by-failure changes are in PROMPTS.md.
- **Why the few-shot examples are synthetic:** taking them from eval postings would inflate the score; a test fails if an example's company appears in the eval set.

## 038. Code pre-rank chooses the ≤25 postings to extract; LLM client owns retries and quota
- **What:** `preRank` scores titles for new-grad wording, profile skills, preferred place and recency, and extracts the top 25 (DECISIONS 030). The OpenAI SDK's own retries are off (`maxRetries: 0`); `createResponder` applies the shared retry policy (429/5xx, Retry-After, jitter) and counts every attempt against the global daily quota (500/day, `createDailyQuota`), which is never retried once exceeded and fails closed if the counter can't be read.
- **Why:** One retry policy and one place to count cost. Measured live: 25 extractions in about 20 s on first run; the cached rerun took 0.4 s with 0 model calls.

## 039. Phase 3 review fixes (reviews/phase-3.md)
- **S1 (in-sample score):** added a 12-case held-out set from companies not in the tuning set (fixed seed 4680), labeled blind by a separate agent from the rule sections only, never used for tuning. v1 90.6% → v2 98.3% held-out (3 runs each). Eval results are now timestamped files tagged with commit and check version, never overwritten.
- **S2 (quotes only had to exist):** check-3 makes quotes support the answer (number in the years quote, about experience; non-negated clearance quote that mentions clearance; description-only except location; min length; grounded `years_required_text`; new-grad evidence). Each reviewer bypass is a test.
- **S3 (overstated claims):** PROMPTS.md rewritten: held-out vs in-sample stated, evidence rules stated exactly, retry counts compared under the same checks, labels described as AI-made and AI-audited, v1/v2 commit order admitted as unprovable from git. The leakage test compares 8-word shingles against both eval sets.
- **S4 (ungrounded skills):** only skills the description mentions are kept; `skillInText` now matches every common spelling (it had missed "Postgres" in text when the profile said "Postgres").
- **S5 (cross-posting cache reuse):** cache hits are re-checked against the current posting's text.
- **S6 (latency/cost, partly):** OpenAI timeout 20 s × 2 attempts; an extraction deadline (no new model call after it; those postings show as "time limit"); a failed cache write keeps the paid result; quota counter errors fail closed without retries. Per-session/IP extraction budgets and the request deadline wiring are Phase 4 (DECISIONS 040).
- **Smaller:** "years not stated" instead of "no years required"; `<posting>` tags inside descriptions neutralized; jobs past the 25-extraction cap returned as `notChecked`; unicode hyphens/ellipses normalized in quote matching.

## 040. Carried into Phase 4 from the Phase 3 review
- **Deadline:** each agent turn gets a deadline passed to search and triage (partial results instead of a timeout); `maxDuration` 300 s on `/api/agent` (Hobby maximum) with the deadline well inside it.
- **Cost:** per-session and per-IP budgets for extractions, and part of the 500/day cap reserved for agent (routing) calls, so one visitor can't drain the shared quota.
- **Second-order injection:** posting text, quotes and skills never go back into the tool-using agent's context; the agent gets ids, enums, counts and scores, and the UI fetches quotes for display.

## 041. The eval caught a validator bug (check-4)
- **What:** check-3's benefits filter matched "pto" inside "crypto" and rejected Coinbase's real requirement in all 3 runs. Fixed with whole-word matching; check version bumped to check-4 so nothing judged by the bug is reused; check-3 result files were discarded as invalid.
- **Why it matters:** stricter checks can create false rejections. The per-case failure list made this visible in one run; it's now a regression test.

## 042. Grounding check-5 and check-6: fix false rejections found in live triage
- **What (check-5):** `years_required_text` is a display summary, not evidence, so an ungrounded one is dropped (set to null) instead of failing the answer (SpaceX "Software Engineer, Full Stack (Data & Video Analysis)"). Explicit no-experience wording ("We do not require any formal experience") supports `years_required_min = 0` without a number or the word "years" (ElevenLabs Payments).
- **What (check-6):** the check-5 live triage still left 2 of 25 SpaceX postings unread: the model joined two real requirement bullets with "; " in one years quote, and the joined string isn't in the text. A quote now counts if every "; "-separated part is an exact quote of at least 8 characters. Nothing invented can pass: each part must be found on its own, and the number/"years"/negation rules still apply to the whole quote.
- **Why:** The end goal is that every posting the user sees was actually read. These were false rejections of correct answers (the right years value with real quotes), not fabrications. They turned postings into "couldn't read requirements" for no reason. The check version is part of the cache key, so nothing judged by the old rules is reused.
- **Result:** live triage 25/25 read, 0 unread. Evals re-run under check-6 (3 runs each): held-out v1 89.4% → v2 98.9%; tuning v1 86.3% → v2 97.9%; 0 answers failed after the retry in any set. check-5 result files are kept for history, but they aren't comparable.
- **Known limitation left as-is:** whether Anduril's "Active US Secret clearance, or a previously granted Secret clearance eligible for reactivation" is answered `yes` or `ability_to_obtain` varies between runs and postings. The job is then flagged "needs clearance eligibility" instead of being dropped. This is a model judgment, so fixing it fairly needs a v3 prompt and a fresh held-out set (PROMPTS.md, Limits).
- **Alternatives:** accepting the flaky unread postings (the retry usually fixes them, but not always); telling the model never to join quotes (a prompt change would need a fresh held-out set to evaluate fairly).
