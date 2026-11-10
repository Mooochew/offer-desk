# Phase 2 Review (job data layer, plus re-check of the Phase 1 findings)

**Verdict:** PASS WITH FIXES
(Nothing blocks Phase 3. Migration 0004 must be applied before Phase 4 writes any `refs`/`files`/`messages`. S1-S5 below should be fixed before or during Phase 3/4, because Phase 3 triage and the Phase 4 tools will build on them.)

## Commands run
- `npm run check`: **passes**. Lint clean (the `coverage/**` warnings from Phase 1 are gone). Typecheck OK. Vitest: **17 files, 172 tests passed**. Coverage on `lib/**`: statements 99.01%, branches 92.88%, functions 97.54%, lines 100%. The floors in `vitest.config.mts` (90/90/85) match TESTING.md. `next build` OK: `/` static, `/api/health` dynamic.
- `npm run check:rls`: **5 failed, 40 passed**. The 5 failures are exactly the ones 0004 fixes: `refs`, `files`, `result_sets` and `messages` "user cannot write (migration 0004)" (insert succeeded), and "files: storage_path must start with the owner's id" (insert succeeded). Everything else passed: own-row CRUD and cross-user isolation on `profiles`/`applications`, a cross-user read block on all 5 server-written tables, the server writing all 5, `action_log` user insert refused (42501), all 5 shared tables refused with a real 42501, the server reading them, `increment_counter` refused for users and atomic for the server, and the `exports` bucket private.
- `npm run check:live`: **7/7 passed** against https://offer-desk-teal.vercel.app. This includes the new "server secrets are configured on the deployment", so Phase 1 N3 is verified live.
- `npm run check:search`: **passed**. Both runs were served fully from cache: 1.3 s first, 0.8 s second, 0 boards refreshed, 60 boards (26 Greenhouse / 21 Ashby / 13 Lever). Breakdown: considered 7,905 → role −6,148 → seniority −981 → internship −83 → age −562 → location −103 → duplicates 0 → **28 remaining** (SoCal + remote, 30 days). 5/5 descriptions loaded as plain text, 3 of them Greenhouse pass-two fetches. I did **not** observe a cold search; the 6.5–8.6 s cold figure in DECISIONS 023 is **unverified** by me.
- `npm run boards:verify` (no `--write`): "145/145 boards alive, 21,334 open jobs". `greenhouse:spacex` timed out in the same run and was counted as alive (see N4).
- `gh run list --limit 3`: all 3 runs `success`, including HEAD `62d5277`. `origin/main` = HEAD; the working tree is clean.
- Read-only DB count with the admin key: 10,689 `postings` (2,307 with descriptions), 145 `board_cache` rows, 0 `counters`.
- Behavior probes with `tsx` (scratch script, outside the repo): location and title edge cases. The results are cited in S2 and N2.
- Eval labels: I read all 16 cases against their full snapshot text (results under S4).

## Phase 1 findings: were they actually fixed?
| P1 item | Status | Evidence |
|---|---|---|
| S1 user-writable refs/files/result_sets/messages | **Fixed in code, not yet live** | `0004_server_written_tables.sql:6-22` revokes insert/update/delete and replaces the policies with select-only. `:25-26` adds the `storage_path like user_id || '/%'` check. Live `check:rls` still fails exactly these 5 checks, as expected. The SQL is correct and sufficient for S1 (see S3 for one new trap it creates) |
| S2 concurrent anonymous sign-in | **Fixed** | `lib/supabase/browser.ts:5,25-28` shares one in-flight promise and clears it in `finally`. `tests/lib/supabase-browser.test.ts` shows 3 concurrent calls → 1 sign-in, plus failure then retry. `browser.ts` is no longer excluded from coverage |
| S3 server env schema in the browser bundle | **Fixed** | `lib/env/public.ts` and `lib/env/server.ts` (`import "server-only"`). The browser client imports only `public.ts`. I did not re-download the live chunks this time (**unverified** in the bundle; the import graph is correct) |
| S4 admin-client rule | **Fixed** | `lib/supabase/server.ts:22-27` is reworded as recommended. DECISIONS 019 |
| S5 schema drift | **Partly fixed** | DECISIONS 016 and the PLAN `counters` row are done. But `PLAN.md:142` still describes `extractions` as "posting_id, description_hash (unique)" (N1) |
| S6 shadcn | **Recorded** | DECISIONS 020 (deferred to Phase 5) |
| S7 check:rls breadth | **Fixed** | `scripts/check-rls.ts` loops over all 7 user tables, adds server writes on `postings` and all server-written tables, makes the shared-table checks require 42501, and uses `try/finally` cleanup. One remaining gap: only *insert* is tested on server-written tables, not update (N3) |
| N1 lint coverage/ | Fixed | `eslint.config.mjs` |
| N2 raw error in health | Fixed | `app/api/health/route.ts` returns "Internal error" and logs the detail |
| N3 server env on Vercel | Fixed | `serverEnvOk`, verified live |
| N4 counters cleanup | Fixed (0004) | It deletes expired rows on every increment. That introduces S3 |
| N5 per-IP limit | Recorded | DECISIONS 018 |
| N6 stale docs | Fixed | PLAN status line and README setup are updated |
| N7 Adzuna | Recorded | DECISIONS 017 |
| N8 atomic confirm / ref numbering | Recorded | DECISIONS 019 (but see S3) |

## Assignment alignment
| Requirement | Status | Where / notes |
|---|---|---|
| LLM integration: send/receive | planned | No `lib/llm/` yet (Phase 3) |
| LLM: API errors, rate limiting | in progress | `lib/http/retry.ts` (backoff with full jitter, honors Retry-After, tested) can be reused for OpenAI. `counters` + `increment_counter` exist; caps are not wired in yet |
| Parse LLM output into commands | planned | Phase 4 |
| Convert to executable operations | planned | Phase 4. `searchJobs(criteria, deps)` is a clean, deterministic target for `search_jobs` |
| Multiple domains | in progress | **External APIs: done** (Greenhouse/Lever/Ashby, live-verified). DB: shared tables used; user CRUD is Phase 4. Files: planned |
| UI: NL input, results, status, feedback | planned | Placeholders. `SourceStatus` + `Breakdown` give Phase 5 the data for the source chips and the breakdown bar |
| Validate LLM output | planned | zod is already used on the board registry and the snapshot (`lib/sources/boards.ts:13`, `lib/search/snapshot.ts:35`) |
| Graceful errors | in progress | Per-board failure isolation, stale-cache fallback, a 10-min error back-off, and a snapshot fallback flagged `usedSnapshot`. All tested |
| Confirmation for destructive ops | planned | The schema is ready. DECISIONS 019 specifies the atomic conditional update |
| Audit log | planned | Table + RLS done. Writes are Phase 4 |
| Deliverables: repo / URL / video | done / done (shell) / planned | CI green. The live URL has no search yet |

## Findings

### Blocking
None.

### Should fix

**S1. The snapshot loader overwrites live shared postings with stale, sometimes truncated, data.**
`lib/search/snapshot.ts:63` calls `store.upsertPostings(board, jobs)`. That is a full upsert on `(source, source_id)` (`supabase-store.ts:87-90`) of title, location, url, `posted_at`, `description`, `description_hash` and `fetched_at = now()`. The snapshot keeps real source IDs (by design), so every "Seed sample pipeline" click or snapshot fallback **overwrites the live rows** with the copy from 2026-11-10. `scripts/snapshot-postings.mts:176` also cuts descriptions to 12,000 chars; one snapshot posting is cut today. Effects:
- Any grader's click silently replaces a full description with an older or truncated one, and marks it as freshly fetched.
- `description_hash` changes, so extraction cache entries miss.
- The extractor can be fed a truncated description while `description_truncated` stays `false`.

Fix: load the snapshot insert-only (`upsert(..., { ignoreDuplicates: true })`), then `select id` by `(source, source_id)` to get the IDs. Add a unit test: "seeding does not overwrite an existing posting's description". Set `description_truncated: true` on anything you cut.

**S2. "Remote - Latin America" and "Remote, South America" count as US-remote.**
`lib/search/location.ts:46`: the `US` regex has a bare `america`. Verified with `tsx`: `isUsRemoteText("Remote - Latin America") === true`, and the same for "Remote, South America" and "Remote - Toronto, CA". This is the same class of bug as the "Remote, KSA" fix in DECISIONS 025, and the next one a grader will spot in the results list. Fix: replace `america` with `(north )?america` only when not preceded by `latin|south|central`, or drop it and rely on `us|usa|united states`. Add the regression cases to `location.test.ts`. ("Toronto, CA" is rare; you can leave it as a known limitation.)

**S3. 0004's counter cleanup will break the planned short-ref numbering.**
`0004_server_written_tables.sql:39` deletes every expired counter on each increment. DECISIONS 019 numbers refs with `increment_counter('ref:<user>:<kind>', ttl)`. Once that counter's TTL passes, it is deleted, numbering restarts at 1, and the next `insert into refs` hits the `(user_id, ref)` primary key (`0001_init.sql:140`), so `save_to_pipeline` fails mid-demo for a returning user. Fix (decide now, before Phase 4): either give ref counters a TTL far beyond the project's life (e.g. 10 years) and document why, or compute the next ref inside one SQL function (`select coalesce(max(substring(ref from 2)::int),0)+1 … for update`). Add a test, or a `check:rls` step, that numbers refs across an expired counter.

**S4. Eval labels: one is wrong, two disagree with the product goal.**
I checked all 16 labels against the posting text and LABELING.md. 11 are correct: Verkada, Coinbase, Affirm (1.5), Roblox, Amplitude, SpaceX (the A-or-B degree/years case and ITAR handled correctly), Anduril JBLM, Notion, Figma, Headway (the AND rule gives 4), Writer.
- **Wrong: Stripe `greenhouse-8332676`, `location_type`.** The label is `unknown`, with the note "No work-mode statement". The posting says **"50% Telecommuting permitted."** By LABELING.md ("part-week office days → hybrid") this is `hybrid`. Fix the label and the `why`.
- **Questionable: Twitch `greenhouse-8917377002`, `is_new_grad_friendly: yes`.** It is "yes" under the literal "level-I title with no years" rule. But the required list includes "Experience developing software in a professional environment" and "Prior experience building consumer-facing products at scale". I would label it `unknown` and tighten the rule to "level-I title with no years **and no professional-experience requirement**".
- **Questionable: Zoox `lever-67982bee…`, `is_new_grad_friendly: yes`.** Its program requirements say "Currently enrolled in a B.S. or M.S. program", so a graduated new grad, the product's user, is not eligible. The rule's "students" clause makes it "yes", but for this product it should be `no`. Either add the rule "requires current enrollment → no", or make it a known exclusion. Note that `isInternship` (`lib/search/title.ts:50`) also misses "Student Worker", so these roles reach triage.
- **Ambiguous, acceptable:** Anduril Sentry `location_type: unknown`. The text says "join our … team in Costa Mesa", "working on a bench with the hardware" and "in the same building", but there is no explicit statement. Keeping `unknown` is a fair "don't infer" test. Make it deliberate in the `why`. Smartsheet `degree: bachelors` comes from an unspecified "A degree"; add one line to LABELING.md saying an unspecified degree means bachelors.
- **Eval design:** 14/16 cases are `clearance: unknown` and 7/16 are `is_new_grad_friendly: unknown`. A model that always answers "unknown" would score 87.5% on clearance. Report a trivial "always unknown/null" baseline next to v1 and v2 in PROMPTS.md, and score years with a "null vs number" split. Otherwise the v1→v2 numbers (the evidence for the 20%) won't show much.

**S5. User-writable free-text columns flow into the model context, so a grader can inflate costs.**
`profiles.filters` (jsonb), `profiles.skills` (text[]) and `applications.notes` (text) have no size limits (`0001_init.sql:113-124,150`). Users write them directly over PostgREST with their own token, and PLAN §4.4 puts the profile into every turn's state block. A curious grader can store a 1 MB `filters` blob, and every one of their 15 turns/hour then sends it to OpenAI on the shared key and the 500/day cap. It is also a prompt-injection channel into the system-level state block (their own session only). Fix: add `check` constraints (`octet_length(filters::text) < 4000`, `array_length(skills,1) <= 50`, `length(notes) <= 2000`) in a migration, and have the state builder truncate and quote user-written fields as data.

### Nice to have
- **N1. Doc drift:**
  - `PLAN.md:142` still shows `extractions` keyed by `description_hash (unique)`;
  - `PLAN.md:224` and `PLAN.md:419` say "at most 40 boards / 40-board cap" while the code selects and refreshes 60 (DECISIONS 024);
  - `DECISIONS.md:89` says 153 boards; the file has 145;
  - PLAN §4.8 `search_jobs(... sources?)`: `SearchCriteria` has no source filter.
- **N2. Free-text role parsing is loose.** `lib/search/title.ts:7`: `api|server` has no word boundaries, so "jobs at Capital One" and "rapid prototyping" both parse as `backend` (verified). The rest of title parsing is fine. For Phase 4, consider giving `search_jobs` an explicit `roles: enum[]` argument that the model fills and zod validates, with the free-text `query` as a fallback. It's more testable, and a stronger prompt-engineering story than regex over the model's paraphrase.
- **N3. `check:rls` tests only `insert` on server-written tables.** The original S1 attack also works through `update files set storage_path = …`. 0004 revokes update, but nothing proves it. Add a user `update` on `files.storage_path` and `delete` on `action_log`, and assert 42501 (or 0 rows).
- **N4. `scripts/verify-boards.mts:36`** prints "145/145 alive" while a board timed out. Print "N alive, M unreachable (kept), K dead".
- **N5. `0004` is not re-runnable.** `drop policy "own rows"` fails on a second paste. Use `drop policy if exists`. Whether the Supabase SQL editor wraps the script in one transaction is **unverified**, so a half-applied run is possible.
- **N6. `lib/http/retry.ts:25-27`:** every non-HTTP error is retried, including `SyntaxError` from a bad body and timeouts. That is fine for boards, but see risk 2 for the time cost.
- **N7. Users can't read `postings`.** It is server-only, so Phase 5's pipeline and results panels must fetch through API routes. They can't join `applications → postings` from the browser. Also route stage changes in the UI through the server, not direct `applications` writes, so the action log stays complete.

## Testing assessment
- The tests are good and behavior-named, and they attack real edge cases taken from live data: Ramp's leading-space titles, Ashby `isRemote` vs `workplaceType`, Lever `lists[]`, a Greenhouse `updated_at` fallback, the ElevenLabs "Remote + Europe" case, "Remote, KSA", "Battery Systems Engineer". Each DECISIONS 025 bug has a regression test (verified by grep).
- `board-cache.test.ts` covers fresh, expired, failed-with-stale, failed-cold, error back-off, refresh cap and time budget with an injected clock. These are exactly the paths that protect the demo. `supabase-store.test.ts` asserts the "don't wipe a fetched description" rule.
- Fixtures are trimmed real responses (4–15 KB). No network in unit tests (`fetchImpl`/`fetchBoard` are injected). No `.only`/`.skip`.
- Gaps:
  - no test that the snapshot loader preserves existing rows (S1);
  - no regression test for "Latin America" (S2);
  - `dedupe.ts` branches are at 70%, and the "newer copy wins" and null-date branches are only partly covered;
  - `check:search` only proves the warm path, unless the cache happens to be expired when it runs. A `--cold` flag that ignores the cache (or uses a throwaway store) would give the gate a real cold-path number.
- `tests/data/data-files.test.ts` keeps the eval cases tied to the snapshot (every case ID exists, enums valid). Good: re-running the snapshot can't silently orphan eval cases.

## Risks to the end goal
1. **Day 2 is still about 13 h for 70% of the grade.** Drafting the labels early (DECISIONS 021/027) was the right move. Fix S4 in the human label check (about 20 min), and protect the eval.
2. **Graders will hit the cold path, not the warm one.** The board TTL is 6 h, and grading happens days after the cache-warming step in Phase 6. The budget at `board-cache.ts:118` only stops *starting* fetches. A fetch started at 24.9 s can run another ~16 s (5 s timeout × 3 attempts + backoff, `retry.ts:44,77`), plus the `postings` upsert of multi-MB Lever/Ashby boards. If the agent then chains `search_jobs` → `triage_results` (Greenhouse pass two + 25 extractions + 2–3 agent calls) in one turn under `maxDuration = 60` (DECISIONS 011), a slow board day can time out the demo's first request. Suggestions:
   - (a) **stale-while-revalidate**: serve expired cache entries immediately and refresh in the background with `after()` (check `node_modules/next/dist/docs/` for the Next 16 API);
   - (b) pass an `AbortSignal` tied to the search deadline into `fetchJson`, and use 2 attempts inside a search;
   - (c) raise `maxDuration` above 60 (DECISIONS 011 itself notes Hobby allows 300 s with Fluid compute) while still aiming for under 30 s;
   - (d) a daily GitHub Actions cron that runs a warm search.
3. **Supabase free projects pause after about 7 days of inactivity** (**unverified** for this project's plan). If grading happens more than a week after the last visit, the URL fails for everyone. The cron in 2(d) also prevents this.
4. **The demo script's numbers no longer match reality.** PLAN §9 scripts "140 → 57" and "Save the top 10". The real breakdown is 7,905 → 28 for 30 days, and "posted this week" will be smaller. After the years/clearance drops in triage, there may be fewer than 10 left. Rewrite the script around the real funnel ("7,900 engineering jobs → 28 → N you can actually apply to" is a *stronger* problem-relevance story). Phase 3 should also choose the 25 postings it extracts by a code pre-rank (new-grad title signal, skill words in the title), not just by newest.
5. **Safety claims depend on 0004 being applied.** Until it is, the S1 attack from Phase 1 is still open on the live database. Apply it, then re-run `check:rls` to 45/45 before any Phase 4 code writes `files`.

## What's done well (verified)
- The data layer runs live from a script: 60 boards across all three sources, a per-source status table, a breakdown that adds up (asserted), a cache hit on the second run, and Greenhouse pass-two descriptions as clean plain text.
- The per-board cache with light job lists (DECISIONS 023) is a sound design. A warm search over 7,905 jobs takes about 1 s, descriptions are loaded only for the postings that need them, and a failed refresh keeps stale jobs and backs off.
- Everything deterministic is in code with a clear boundary. `searchJobs` takes `criteria` from the LLM and does all selection, filtering, dedupe and counting itself. This upholds "the LLM routes and extracts; code computes".
- Real problems found live were turned into decisions plus regression tests: source rotation (024), US-remote rules (025), and not deleting temporarily unreachable boards (029, after the Anduril timeout).
- Most Phase 1 findings were actually fixed in code and tests, not just marked done in the docs. The one that remains open (0004) is ready and correct, and `check:rls` fails exactly where it should until it's applied.
- The eval labels are mostly careful and target real traps (vesting "2 year", company age "20 years", "1.5+", ITAR vs clearance, A-and-B years). Every case is tied to the snapshot by a CI test.
