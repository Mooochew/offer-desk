# Handoff: Offer Desk (CS4680 Assignment 4)

Updated 2026-11-11 at the end of **Phase 5**. **Phases 0–5 are done. Phase 6 (ship) is next.** The previous session ended here on purpose, so start Phase 6 from this file.

Read this first, then:
- `PLAN.md` (Phase 6 is at the end of section 6; the demo script is section 9);
- `DECISIONS.md` (001–060);
- `TESTING.md` (the gate rules);
- `PROMPTS.md` (the prompt-engineering write-up);
- `reviews/phase-4.md` and `reviews/phase-5.md` (what's left open).

## Where we are

| Phase | Status |
|---|---|
| 0. Verify and set up | ✅ Done |
| 1. Foundation | ✅ Done (`reviews/phase-1.md`, fixes applied) |
| 2. Job data layer | ✅ Done (`reviews/phase-2.md`, fixes applied) |
| 3. Extraction and triage | ✅ Done (`reviews/phase-3.md`, fixes applied, check-6) |
| 4. Agent, tools, safety | ✅ Done (`reviews/phase-4.md` PASS WITH FIXES; fixes in DECISIONS 054) |
| 5. UI | ✅ Done (`reviews/phase-5.md` PASS WITH FIXES; fixes in DECISIONS 060) |
| **6. Ship** | **Next.** See "Phase 6 to-do" below |

- Repo: https://github.com/Mooochew/offer-desk (public). Live: https://offer-desk-teal.vercel.app (Vercel auto-deploys `main`; last deployed commit `e9b82b9`, CI green).
- Supabase migrations 0001–0004 are applied. Phases 4–5 needed no new migration.
- History was rewritten on 2026-11-10 to remove Claude co-author trailers (the user approved). A local tag `backup-before-rewrite` holds the old history.

## Working agreements (from the user)

- **Process per phase:**
  1. Build independently.
  2. Record every decision in `DECISIONS.md` with the reason, referencing the end goal.
  3. Pass the gate: tests per `TESTING.md`, `npm run check`, green CI, live checks, then a **fresh independent reviewer agent** (`.claude/agents/phase-reviewer.md`) that writes `reviews/phase-N.md`.
  4. Do one round of fixes.
  5. **Stop** and report.
- **Commits: never add a `Co-Authored-By: Claude` line** (or any Claude attribution). Push after committing.
- The user prefers plain explanations, confirms choices, and wants independent work within a phase.
- The user records the demo video and submits the Google Form themselves. Prepare everything for them and say what's left.

## Phase 6 to-do (PLAN Phase 6 + carry-ins)

1. **README.md** (it's still the Phase 1 stub):
   - the problem, with real numbers from the app (e.g. "7,917 listings → 9 after the code prefilter → 8 ranked");
   - features and a screenshot (`npm run check:ui` with `SHOTS=<dir>` makes them);
   - the Mermaid architecture diagram from PLAN 4.1, updated (`lib/agent`, `/api/state`);
   - the LLM/code split;
   - how the assignment requirements map to code (the table in PLAN section 1);
   - setup and env vars (`.env.example`), and how to run the checks and evals;
   - known limitations: exact-match dedupe, Adzuna not used, board coverage, snapshot fallback, no streaming, the v4 delete→archive miss, occasional extra searches, per-IP budgets.
2. **Daily warm-up cron** (DECISIONS 033, carried in since Phase 2): a protected endpoint (e.g. `GET /api/cron/warm` that checks `Authorization: Bearer ${CRON_SECRET}`). It refreshes the most-used boards with `loadBoards` and touches Supabase. Add `vercel.json` `crons` (daily on Hobby) and the `CRON_SECRET` env var in Vercel; **the user must add that secret in the Vercel dashboard.** Test the auth (401 without the secret).
3. **Phase 5 review leftovers worth doing before recording** (reviews/phase-5.md):
   - **N11 ranking relevance:** "Server Hardware Systems Engineer (Starlink)" ranks #2 for "backend and full-stack". Consider a title role-match bonus in `lib/triage/score.ts` or the pre-rank, with a test. It shows on screen in the demo.
   - **N1:** source chips after a reload (add `result_sets.source_status` to `/api/state`).
   - **N3:** board tabs need arrow-key navigation; dark-mode accent contrast is about 3.7:1.
   - **N4:** http(s)-only posting URLs at ingestion. **N5:** a rate limit on `/api/state`. **N9:** the Review fallback.
4. **Finish PROMPTS.md and DECISIONS.md** for submission (they are current through Phase 5; add a short summary at the top of PROMPTS.md if useful).
5. **Demo prep for the user:** a short recording checklist:
   - record in a fresh incognito window;
   - click Load demo profile, then Seed sample pipeline, then run the section 9 prompts;
   - rehearse the same day (live numbers change);
   - cut the 6–12 s waits in editing;
   - don't run live agent checks on recording day (they spend the shared budget).
6. Gate as usual: `npm run check`, CI, `check:rls`, `check:live`, and one `check:ui` against the live URL (it uses 6 chat turns), then an independent review → `reviews/phase-6.md`.

## Budgets (read before running live checks)

- Chat: 15 turns per hour per session and 30 per hour per IP.
- Agent model calls: 40 per hour per session, **60 per hour per IP**, and 200 per day per IP (across chat and extraction).
- Global: **500 OpenAI requests per day** (extraction may use at most 400).
- `check:agent` and `check:ui` each use 6 chat turns (about 18 agent calls). Running both twice in one hour from one network hits the per-IP limit. That's by design, and the UI shows the limit message. Local runs (`localhost`) use a different IP key from runs against the deployment.
- Evals (`npm run eval`, `npm run eval:agent`) call OpenAI directly, outside the app's counters. They cost money, not app quota.

## What's built (by phase)

- **Phase 2–3:**
  - `lib/sources`, `lib/search`: 145 boards, the per-board cache with stale-while-revalidate, and the code prefilter.
  - `lib/triage`: extraction with Structured Outputs, grounding checks (check-6) and an eval; extraction prompt `prompts/extract-v2.ts`.
- **Phase 4:**
  - `lib/agent/`: the store interface and Supabase store, refs, the executor and confirmation flow, the state block, the turn loop, runtime wiring, and 15 tools in `tools/`.
  - `lib/files/`: CSV, checklist, ICS and timezone helpers. `lib/safety/limits.ts`: budgets.
  - Routes: `/api/agent`, `/api/actions/[id]/confirm|reject`, `/api/demo/profile|seed`, `/api/files/[id]/url`.
  - Agent prompt `prompts/system-v4.ts`. Routing eval: `npm run eval:agent`.
- **Phase 5:**
  - `components/`: `offer-desk`, `chat-panel`, `results-view`, `pipeline-view`, `action-log`, `confirm-dialog`, `ui`, `api`.
  - `POST /api/state` (`lib/agent/session-state.ts`), shared funnel math (`lib/agent/funnel.ts`), and display helpers (`lib/ui/format.ts`).

## Current numbers

- **Tests:** `npm run check`: 33 files, 390 tests; line coverage 98.9%, branch coverage 87.5% (floors 90/85).
- **Extraction eval** (check-6, 3 runs each): held-out v1 89.4% → **v2 98.9%**; tuning 86.3% → 97.9%.
- **Routing eval:**
  - Tuning: v1 16/18 → v3 18/18; v4 41/42 over 6 runs.
  - Held-out: v4 22/24 vs v3 24/24. v4 twice proposed archive for "delete"; it fails safe. See PROMPTS.md.
- **Live demo flow:** 5–14 s per turn. Live triage reads 25/25 postings.

## Key facts and gotchas

- **Stack:** Next.js 16.4 (App Router). **Read `node_modules/next/dist/docs/` before writing Next code** (per `AGENTS.md`). Supabase (anonymous auth; Bearer-token auth to API routes, no `@supabase/ssr`). OpenAI Responses API with `gpt-6-luna` for both the agent and extraction.
- **Secrets:** `.env.local` (gitignored). Supabase keys use the `sb_publishable_` / `sb_secret_` format. Never print the values.
- **Scripts that import app code** run with `tsx --conditions=react-server`, as `.mts` files.
- **Live checks:**
  - Read-only: `npm run check:rls | check:live | check:search | check:triage`.
  - Need a running server or `BASE_URL`: `check:agent` and `check:ui`. `check:ui` drives the installed Edge headless via `playwright-core`; use `BROWSER_CHANNEL=chrome` for Chrome and `SHOTS=<dir>` for screenshots.
- **npm lockfile bug:** `npm install <pkg>` can drop every `node_modules/@rolldown/binding-*` entry from the lockfile. Check that `grep -c '"node_modules/@rolldown/binding-' package-lock.json` is 15. If not, restore the lockfile from git, add only the new package's entry, and run `npm ci` with the dev server stopped. TESTING.md has the details.
- **Windows:**
  - Stopping a background `npm start` can leave Node holding port 3000; free it with `Get-NetTCPConnection -LocalPort 3000`.
  - A running server locks `node_modules`, so `npm ci` fails with EPERM.
  - Git Bash heredocs break on non-ASCII text. Write Python edit scripts to `scripts/.out/` (gitignored) and run them with `PYTHONIOENCODING=utf-8`.
- **Vitest 5 quirk:** a rejecting `vi.fn()` inside a `vi.mock` factory fails tests even when caught; use plain fake functions.
- **Newer Chromium returns a Promise from `scrollIntoView`.** A `useEffect` arrow must not return it; use braces.
- **Data:** 145 company boards (`data/ats_boards.json`), a 120-posting snapshot (`data/sample_postings.json`) and a demo profile (`data/demo_profile.json`). Cursor's live Ashby board serves SpaceX text (an upstream issue).
- **Test users:** every live check deletes its anonymous users and files at the end. If a check crashes, find leftover test users by matching their `action_log` activity to your run, and delete only those IDs. Never bulk-delete "recent users", because real graders may be among them.
