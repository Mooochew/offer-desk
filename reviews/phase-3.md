# Phase 3 Review (extraction and triage, plus re-check of the Phase 2 findings)

**Verdict:** PASS WITH FIXES
(Nothing blocks Phase 4. The code is clean and well tested, and the live pipeline works. But the prompt-engineering evidence, worth 20%, is weaker than PROMPTS.md says. The v2 score is in-sample, and several claims are overstated. Two grounding gaps also let the model drop or promote a job with a quote that doesn't support the answer. Fix S1-S4 before Phase 6 writes PROMPTS.md up for submission. S5-S6 shape Phase 4, so decide them now.)

## Commands run
- `npm run check`: **passes**. Lint and typecheck are clean. Vitest: **21 files, 232 tests passed**. Coverage on `lib/**`: statements 98.46%, branches 91.28%, functions 96.66%, lines 99.44%. The floors in `vitest.config.mts` (90/90/85) are unchanged. `next build` OK. Weak spots: `lib/llm/openai.ts` 83% statements / 78% branches (the real-client path, lines 26-27), `lib/triage/score.ts` 65% branches, `lib/triage/extract.ts` 81% branches.
- `npm run check:rls`: **52/52 passed**, 0 failed. Migration 0004 is live: server-written tables refuse user writes and deletes, the size caps reject a 5,000-char name and 10,000-char notes, and `storage_path` must start with the owner's id.
- `npm run check:live`: **7/7 passed** against https://offer-desk-teal.vercel.app.
- `npm run check:search`: **passed**, fully warm (792 ms, then 568 ms, 0 boards refreshed). 7,905 considered → **27 remaining**. 5/5 descriptions came back as plain text. The cold path is still **unverified** by me.
- `npm run check:triage`: **passed**, served entirely from cache. Run 1: 457 ms, **0 model calls**, 25 cache hits. Run 2: 224 ms, 0 calls. Funnel: 27 candidates → 25 checked → 6 dropped for years → 19 ranked, 0 unread. The "25 extractions in about 20 s" first-run figure (DECISIONS 038) is **unverified** by me, because everything was cached.
- **`npm run eval -- extract-v2 1` (16 calls). This overwrote `evals/extraction/results/extract-v2.json`.** The original (3 runs, 97.5%) is backed up at `C:\Users\MUHTHY~1\AppData\Local\Temp\claude\ca87869e7751d338\6d79c3f4-8b52-4c20-94e6-91e0121c119f\scratchpad\extract-v2.original.json`. `git checkout -- evals/extraction/results/extract-v2.json` also restores it. Result: years, clearance, location and degree all 100%, new-grad 93.8%, **overall 98.8%**. **1/16 answers needed the corrective retry** (PROMPTS.md says 0/48). The one mismatch was Coinbase new-grad, "unknown" → "no". So the headline v2 numbers reproduce, in-sample.
- `gh run list --limit 3`: all 3 runs `success`, including "Phase 3: extraction and triage". The working tree was clean before my eval run. No `.only` or `.skip` in `tests/`.
- Probes (scratch scripts outside the repo):
  - adversarial inputs to `groundingProblems` (results in S2);
  - a read-only query of the cached `extractions` rows for the top live results (S4, S6);
  - a phrase search of eval vs. non-eval snapshot postings (S1);
  - a scan for snapshot postings that share a description (S5).
- File mtimes and the git log, to check the v1→v2 timeline (S1).

## Phase 2 findings: were they actually fixed?
| P2 item | Status | Evidence |
|---|---|---|
| S1 snapshot overwrites live rows | **Fixed** | `lib/search/supabase-store.ts:107-108` uses `ignoreDuplicates: true` (INSERT … ON CONFLICT DO NOTHING). The regression test exists (DECISIONS 030) |
| S2 "Latin America" counts as US | **Fixed** | `tests/lib/search/location.test.ts:14` covers "Remote - Latin America" and "Remote, South America" |
| S3 ref counter expiry | **Decided, not built** | DECISIONS 032 (10-year TTL). Phase 4 must implement it. No test can exist yet |
| S4 labels plus baseline | **Fixed** | Stripe is hybrid, Twitch and Zoox are corrected, and the baseline is reported in the eval script and PROMPTS.md. But see S1/S3 below on how blind the audit was |
| S5 unbounded user fields | **Fixed (DB side)** | 0004 caps the profile fields and notes, verified live by `check:rls`. Quoting user fields as data in the state builder is Phase 4 |
| N1 doc drift | Mostly fixed | PLAN still says `prompts/extract.v1.md` / `extract.v2.md` (`PLAN.md:359-360`), but the code uses `.ts`. Trivial |
| N2 `api`/`server` word boundaries | Fixed | `lib/search/title.ts:7-8` |
| N3 `check:rls` update test | **Partly** | User deletes of server-written rows are now tested (`check-rls.ts:110-112`). A user **update** of `files.storage_path`, the original attack, is still not tested |
| N4 boards:verify output | Fixed | `scripts/verify-boards.mts:37-39` reports answered / dead / unreachable |
| N5 0004 re-runnable | Fixed (per DECISIONS 030) | Not re-run by me |
| Phase 3 carry-in: code pre-rank | **Done** | `lib/triage/prerank.ts`, tested. With only 27 candidates in the demo funnel it barely matters today, but it is correct |
| Phase 3 carry-in: baseline next to scores | **Done** | `scripts/eval-extraction.mts:29-36` |
| LABELING.md "a person must check them before Phase 3" | **Not done** | `LABELING.md:5` still says so, and PLAN Phase 3 step 1 asks for a human check. The only check was a second AI agent (`LABEL_AUDIT.md`). Either do the 20-minute human pass or change the docs to say what actually happened |

## Assignment alignment
| Requirement | Status | Where / notes |
|---|---|---|
| LLM integration: send/receive | **done** (extraction) | `lib/llm/openai.ts` uses the Responses API with Structured Outputs. Agent calls come in Phase 4 |
| LLM: API errors, rate limiting | **done / in progress** | Shared `withRetry` (429/5xx, Retry-After, jitter) with SDK retries off, and a global daily quota counted per attempt (`lib/llm/quota.ts`). Per-session and per-IP limits are Phase 4. No overall deadline yet (S6) |
| Parse LLM output into commands | in progress | Extraction output is parsed and validated (zod plus grounding). Tool-call parsing is Phase 4 |
| Convert to executable operations | planned | Phase 4. `triageJobs(jobs, profile, filters, deps)` is a clean target for `triage_results` |
| Multiple domains | in progress | External APIs: done. DB: shared caches done, user CRUD is Phase 4. Files: Phase 4 |
| UI: NL input, results, status, feedback | planned | Phase 5. `TriageBreakdown`, `DroppedJob.evidence` and `UnreadJob.reason` give it what it needs |
| Validate LLM output | **in progress, with gaps** | Strict schema, zod and quote checks. But the quotes aren't tied to the values, and skills, new-grad and degree are ungrounded (S2, S4) |
| Graceful errors | done (triage) | Failed extractions and API errors are kept visible as "unread". API errors aren't cached. Tested |
| Confirmation for destructive ops | planned | Phase 4 |
| Audit log | planned | Phase 4 (table and RLS verified live) |
| Deliverables: repo / URL / video | done / shell only / planned | CI green. The live URL has no agent or UI yet |

## Findings

### Blocking
None.

### Should fix

**S1. The v2 eval score is in-sample. PROMPTS.md presents it as a generalization result and overstates the mitigations.**
What I verified:
- **The v2 instructions contain phrases unique to eval postings.**
  - `prompts/extract-v2.ts` quotes "50% telecommuting" (in the snapshot it appears only in the Stripe eval case), "1.5+ years → 1.5" (only Affirm), "Over 5 years → 5" (Writer) and "from a hub or remotely" (Figma: "hubs or remotely").
  - The travel rule ("Travel requirements don't change the work mode") exists for Anduril JBLM.
  - The file's own header comment names the eval company behind each rule (Roblox, Notion, Headway, Anduril, Smartsheet, Zoox).
- **The few-shot examples are synthetic**, which is true, but they also act out the eval patterns. Example 1 (2+ AND 3+ → 3, Tue/Thu office) mirrors Headway and Notion. Example 3 (student-only → "no") mirrors Zoox.
- **The "rules come from LABELING.md, written before v1 ran" mitigation (`PROMPTS.md:72`) doesn't hold.** The LABELING tie-breakers were derived from these same 16 cases (LABEL_AUDIT.md's "Rule ambiguities" names Zoox, Smartsheet, Figma, Anduril JBLM, Notion, SpaceX and Headway). So v2 amounts to "the labeling guide for these 16 cases, given to the model". That is a legitimate technique, but the score that results is training accuracy.
- **The audit wasn't blind.** `LABELING.md`'s "tricky cases" section gives the answer for about 10 of the 16 cases (Stripe "50% Telecommuting permitted", Zoox student-only, Headway A-and-B, Affirm 1.5, SpaceX ITAR, and so on). The auditor read that guide, so "relabeled all 16 blind and agreed on 80/80" (`PROMPTS.md:31`) overstates its independence.
- **The timeline can't be verified.** v1, v2, the eval and both results all land in one commit (`0c3130b`). `extract-v1.ts` was last modified at 21:25:47, the saved v1 run finished at 21:27:25, and `extract-v2.ts` was last modified 33 s later, at 21:27:58. The results file is overwritten on every run, so how many v1/v2 iterations ran against the eval is unknowable. "v1 was written as an honest first attempt before running the eval" may be true, but nothing in the repo shows it.

Why it matters: prompt engineering is 20%, and this is its centerpiece. A grader who opens `extract-v2.ts` will see "50% telecommuting" and the company names in the comment, and discount the 98%. Being upfront scores better than being caught.

Fix (about 45 min, about $0.05):
- (a) Take 10-12 snapshot postings **not** in the eval and not used for any rule. Label them with the field table only, without the tricky-case list (ideally a human does this, which also closes the LABELING "person must check" gap). Run v1 and v2 × 3 once, and **don't change the prompt afterwards**. Report "in-sample (16, used to write v2)" and "held-out (N, never looked at)" side by side.
- (b) Rewrite the v2 rule examples in generic words ("partial telecommuting" with no percentage; "a decimal minimum like 2.5+"), and remove the company names from the header comment, or say plainly in PROMPTS.md that they are there and why.
- (c) Correct `PROMPTS.md:31` and `:72` ("the guide was written from these cases; the audit saw it").
- (d) Make the eval write `results/<version>-<timestamp>.json` with the git SHA, `EXTRACTION_CHECK_VERSION` and a hash of the prompt, so the history survives.

**S2. The grounding check proves a quote exists, not that it supports the answer. The LLM can drop a job on a quote that contradicts its own number.**
`lib/triage/schema.ts:93-111`. Verified with `tsx`, against a posting that says "1+ years … No security clearance required … remote-control vehicles … vests over 4 years". **Every one of these returns `[]`, meaning grounded:**
- `years_required_min: 5`, evidence "1+ years of professional experience". The job is **dropped** for years (`filter.ts:20`), and the UI would show a quote saying 1+.
- `years_required_min: 4`, evidence "vests over 4 years" (a benefit, the exact trap the eval targets).
- `clearance_required: "yes"`, evidence "security clearance", cut out of "No security clearance required". The job is dropped.
- `clearance_required: "yes"`, evidence "Company: Acme". Quotes may come from the title, company and locations header lines.
- `years_required_min: 3`, evidence "e". A one-character quote passes.
- `location_type: "remote"`, evidence "remote", which only appears in "remote-control".
- `years_required_text: "10+ years in Rust"`. This field is never grounded, and the UI or the agent may show it.

The model rarely does this on the eval, but PROMPTS.md says "'Don't make things up' becomes a rule the code enforces" and DECISIONS 034 says drops use only "grounded hard facts". Today that is only half true, and a hard filter that hides jobs is the one place it matters most.

Cheap code fixes:
- the years number (as digits, with ranges and decimals allowed) must appear in `evidence.years`, and `years_required_text` must also be a verified quote (or drop the field);
- a clearance "yes"/"ability_to_obtain" quote must contain a clearance word (`clearance|secret|ts/sci|polygraph`) and must not match `no (security )?clearance`;
- a minimum quote length of about 8 characters, or 2 words;
- quotes must come from the description, not the header lines (or allow the header for `location` only, which is a real use: "Listed locations: Remote").

Add each of these as a failing-first unit test, then bump `EXTRACTION_CHECK_VERSION`.

**S3. PROMPTS.md overstates several things beyond S1.**
- "Every non-default answer must cite a quote" (`PROMPTS.md:22`) is false. `is_new_grad_friendly` (worth +20 points and the "new-grad friendly" label in the why line) and `degree` need no evidence (`schema.ts:102-110`), and the probe confirmed `new_grad=yes` with no evidence passes. Either require `evidence.new_grad` for "yes"/"no", or reword the claim.
- "Answers needing the corrective retry: v1 5/48, v2 0/48" compares different validators. The saved v1 run finished at 21:27:25 and `schema.ts` (check-2: bullet markers ignored, long quotes trimmed) was changed at 21:31:36, so **v1 was scored under check-1 and v2 under check-2**. Some of v1's 5 retries may be validator false-rejects, not model errors. My v2 rerun also needed 1/16. Re-run v1 under check-2, or footnote it.
- "v2 was run twice … 97.5–98.3%": only the 97.5% run was on disk, so 98.3% is unrecorded. My 1-run rerun gave 98.8%, so the range is plausible. Keep every run (S1d).
- "a test enforces this" (no leakage): `tests/lib/triage/extract.test.ts:147-155` only checks that the example's `Company:` line isn't an eval company. The examples use "Example Robotics", so the test can't fail for any realistic leak. Strengthen it: no 6-word sequence from any example (or from the instructions) appears in any eval posting's text. That would also have flagged S1.

**S4. Skills are 50% of the score, but they are ungrounded, unevaluated and unstable between runs.**
- `score.ts:55-60` gives up to 50 of 100 points from `skills_required` / `skills_preferred`. These are not checked against the text (the probe showed an invented skill, and even a 47-character instruction string, pass zod), and the eval doesn't score them.
- They aren't stable. The cached rows for the live #1 result (ElevenLabs Payments Engine, score 72) show the **same prompt** returning 5 required + 5 preferred skills in one run and 1 + 1 in another. The demo profile's Python match then moves the skills part from about 13 to 33 points. The ranking the demo shows is driven mostly by this noise.
- The why line ("Matches Python, TypeScript …") states, as fact, skills the code never verified.

Fix (code computes): keep only extracted skills that `skillInText(skill, description)` finds (one line, using the existing helper). Better still, have code scan the description for the **profile's** skills, and use the LLM only to say which section (required or preferred) each one is in. Add a test.

**S5. Cache hits reuse another posting's judgments and quotes.**
- The cache key is `sha256(description)` (`lib/sources/normalize.ts:47`, `extraction-cache.ts:148`). But the model sees, and grounding checks against, title + company + listed locations + description (`extract.ts:29-40`).
- The dedupe key includes the primary location, so copies of one job in several cities survive dedupe. The snapshot has 5 such groups, among them ZipRecruiter "Santa Monica, CA" vs "Remote" and Harvey "Remote" vs "New York". Whichever copy is extracted first fixes `location_type` and `evidence.location` (for example "Listed locations: Remote") for the other copy. That quote doesn't appear in the other posting, and the evidence popover would show it.
- Cached rows are re-validated with zod only, not grounding (`supabase-extraction-store.ts:172`).

Fix: on a cache hit, re-run `groundingProblems(extraction, formatPosting(current).text)` and treat a failure as a miss. It costs nothing. Or hash the formatted text instead of the description.

**S6. Phase 4 latency and cost. A single agent turn has no deadline, and the 500/day quota can be drained by one user.**
- **Timeouts.** `openai.ts:26` sets `timeout: 45_000`, and `withRetry` gives 3 attempts with every non-HTTP error retried, including `APIConnectionTimeoutError`. So one stuck call can take about 135 s, and the corrective retry doubles that. A cold search can already take about 41 s (Phase 2 risk 2; DECISIONS 031 is still planned). With `maxDuration = 60` (DECISIONS 011), "search + triage of 25 + 2-3 agent calls" in one request is likely to time out on a slow day.
  - Fix: pass a request deadline (an `AbortSignal`) through `triageJobs` → `extractMany` → `create`, and use about a 15 s per-attempt timeout with 2 attempts inside a turn.
  - When the deadline nears, return the partial result, with the remaining postings marked "not checked yet", rather than failing the turn.
  - Consider `maxDuration` 300 (DECISIONS 011 notes Hobby allows it with Fluid compute) as headroom, while still aiming for under 30 s.
- **Quota fairness.** A new query or location gives a different set of 25 postings, costing 25-50 extraction calls. At DECISIONS 003's 15 turns/hour per session (and sessions are free to mint), one person can use the global 500/day in well under an hour, and every grader then gets "Daily AI request limit reached".
  - Fix: a separate extraction budget per session/IP (for example 75 extraction calls/hour), and **reserve** part of the global cap for agent calls, so triage can never starve chat. Surface `QuotaExceededError` as its own UI state, not as "AI unavailable" (`triage.ts:71-73` currently files it as "AI unavailable" with the message as detail).
- **Small.** A quota-counter DB error is a plain `Error`, so `createResponder` retries it 3 times (`openai.ts:62` only vetoes `QuotaExceededError`). It does fail closed, but slowly. Also, an `extractions` write failure (`supabase-extraction-store.ts:194` throws) turns an extraction that already succeeded, and was paid for, into "AI unavailable", and it is paid for again next search. Log the write error and keep the result.

### Nice to have
- **N1. "no years required" is shown when years are merely not stated.** `why.ts:4`: `null` means "not stated or not found", not "none required". In the live run, GitLab's **"Intermediate** Fullstack Engineer" shows "no years required". That breaks DECISIONS 035's "can't state anything the data doesn't hold". Use "years not stated".
- **N2. The "0 years → new-grad yes" rule fires on boilerplate.** The live #1 result, ElevenLabs Payments Engine, is "0 years required · new-grad friendly" because of "We do not require any formal experience, certifications, or degrees". That literally follows the rule, but it is a backend payments role. Worth a rule ("a 'no formal experience required' policy line isn't a new-grad target") **validated on the held-out set**, not on the 16 cases. Or just mention it in the limits section.
- **N3. Prompt-injection hardening.**
  - Extraction: a description that contains `</posting>` closes the delimiter (`extract.ts:42-44`). Strip or escape `<posting`/`</posting` in the input.
  - Phase 4 (more important): extraction output (quotes up to 300 chars, skills, `years_required_text`) and raw titles will go into the **tool-using** agent's context through `triage_results`. That is a second-order injection path, which the PROMPTS.md claim "the extraction call has no tools" doesn't cover. Return IDs, enums and counts to the agent; let the UI fetch the quotes; label tool results as data in `system.v1`. The confirmation flow is the backstop, so keep it.
- **N4. `notChecked` jobs are counted but not returned** (`triage.ts:103`). When Phase 4 builds `triage_results`, include them as a "not checked (over the 25 limit)" list, so "never silently dropped" stays true.
- **N5. Failed extractions are cached forever for that version** (`extraction-cache.ts:164-168`). A one-off double glitch permanently labels a posting "extraction failed". Give failed rows a TTL (for example 1 day).
- **N6. Grounding false negatives.**
  - A correct quote flattened to one line with " - " between bullets fails (the source's bullet is stripped, the quote's inline " - " is not). Verified.
  - So does a quote with an ellipsis. Unicode U+2011/U+2212 hyphens aren't normalized.
  - The retry usually recovers, at the cost of a call. Normalize `\s[-*•]\s` everywhere, and tell the model "no ellipses".
- **N7. `confidence` column holds "truncated"/"full"** (`supabase-extraction-store.ts:190`). That is a misnamed column. Rename it or record it in DECISIONS.
- **N8. Usage tokens aren't logged.** `LlmResponse.usage` exists, but nobody reads it. Phase 4's action log could record tokens per call, which is cheap evidence for the "cost control" story.

## Testing assessment
- The tests assert behavior and have clear names. The extraction tests cover fabricated quotes, missing evidence, non-JSON output, schema paths, the corrective retry with the exact problems, giving up, API errors thrown rather than cached, and truncation. They also check that every few-shot example passes the same checks as real answers, which is a nice touch. The triage tests cover cache hit/miss, caching validation failures but not API errors, the cache key including the check version, "never drop for new-grad = no", and an end-to-end pipeline count with an injected clock. The LLM client tests cover 429 retry with quota counted per attempt, no retry on 400, no call once over quota, and failing closed.
- No network in unit tests (a fake model and in-memory store). No `.only`/`.skip`. The coverage floors are unchanged.
- **Gaps (TESTING.md rule 5, "hostile LLM output"):**
  - Nothing tries the attacks in S2: a number that contradicts its quote, a quote from the header lines, one-character quotes, "no clearance" cut down to "clearance".
  - No test for ungrounded skills (S4).
  - No test that a cache hit is re-checked against the current posting (S5).
  - No `</posting>` input.
  - No test of the counter-error retry path.
  - No test that a store write failure keeps the result.
  - The leakage test can't fail (S3).
- `score.ts` is at 65% branch coverage; the recency buckets at 4 and 2 points are untested. Small, but it is user-visible ranking.
- `check:triage` is strong as a gate: it asserts "no ranked job exceeds maxYears", "every drop cites evidence" and that the cached rerun makes 0 calls with an identical ranking. Consider a `--fresh` flag that uses a throwaway prompt-version suffix, so the gate can measure a real first run on demand.

## Risks to the end goal
1. **The prompt-engineering grade depends on S1.** Today the story is "we wrote rules from 16 cases and scored 98% on those 16 cases". A small held-out set turns that into real evidence, and it is the best value per hour left in the plan.
2. **The first agent turn on a cold day will exceed 60 s** unless deadlines are threaded through search and triage (S6, DECISIONS 031). That is the demo (30%) and the graders' first impression. Do this first in Phase 4, before building more tools.
3. **One curious user can use up the whole day's AI budget** (S6). Graders arrive in bursts. Per-session extraction caps plus a reserved slice for agent calls are about 30 minutes of work.
4. **Ranking quality looks random to a grader who reads the postings** (S4, N1, N2). The #1 live result is a payments backend role labeled "new-grad friendly · 0 years required", and an "Intermediate" role shows "no years required". Grounded skills and honest wording fix most of this in code.
5. **Schedule.** Phases 4-6 are about 10 h on day 2. S2, S4, S5 and N1 are each under 15 minutes of code plus tests. S1 is about 45 minutes. S6 belongs in Phase 4 anyway. None of this is scope creep. Don't start a v3 prompt; the held-out set matters more.

## What's done well (verified)
- **The LLM/code boundary is mostly real.**
  - Extraction is the only LLM call.
  - Filtering, scoring, the why line, the pre-rank and every count are code.
  - The soft "new-grad" judgment only ranks (DECISIONS 034, with a test).
  - Failed or unavailable extractions stay visible as "unread" and are never dropped.
  - `check:triage` asserts the hard-filter invariants on live data.
- **Strict Structured Outputs plus zod re-validation, a grounding check and a corrective retry.** The eval shows the retry fixed every failure (v1: 5/48 retried, 0 failed).
- **The cache key includes both the prompt version and the validator version** (`extract-v2/check-2`, verified in the DB: the old `extract-v2` rows are ignored), and cached rows are re-validated against the schema. Changing either the prompt or the checks can't serve stale judgments.
- **One retry policy and one quota counter for OpenAI.** SDK retries are off, quota is counted per attempt and never retried, and the counter fails closed. All of this is tested.
- **The eval reports a trivial baseline, several runs and min–max.** It exposed that v1's new-grad field was *below* baseline (43.8% vs 56.3%, verified in `extract-v1.json`). The v1 failures in PROMPTS.md match the saved outputs one for one (Roblox and Notion onsite, Headway 1, Zoox yes, Smartsheet degree unknown, Anduril degree none). The v2 numbers reproduce (98.8% in my 1-run rerun).
- **The Phase 2 fixes are real and verified live:** 0004 is applied (52/52), the snapshot is insert-only, the "Latin America" fix is in, the size caps are enforced, and `boards:verify` reports honestly.

> Note (2026-11-10): commit IDs in this report were updated after the repository history was rewritten to remove commit-message attribution trailers. The code at each commit is unchanged.
