# Handoff: Offer Desk (CS4680 Assignment 4)

Updated 2026-11-11 at the end of **Phase 6**. **All build phases (0–6) are done.** What remains is the user's: record the demo video, upload it, and submit the Google Form (`docs/DEMO.md`).

Read this first, then:
- `README.md` (the submission-facing overview);
- `docs/DEMO.md` (the recording checklist and script);
- `DECISIONS.md` (001–063);
- `TESTING.md` (the gate rules);
- `PROMPTS.md` (the prompt-engineering write-up);
- `reviews/phase-6.md` (the final review; its open nice-to-haves are listed in DECISIONS 063).

## Where we are

| Phase | Status |
|---|---|
| 0. Verify and set up | ✅ Done |
| 1. Foundation | ✅ Done (`reviews/phase-1.md`, fixes applied) |
| 2. Job data layer | ✅ Done (`reviews/phase-2.md`, fixes applied) |
| 3. Extraction and triage | ✅ Done (`reviews/phase-3.md`, fixes applied, check-6) |
| 4. Agent, tools, safety | ✅ Done (`reviews/phase-4.md` PASS WITH FIXES; fixes in DECISIONS 054) |
| 5. UI | ✅ Done (`reviews/phase-5.md` PASS WITH FIXES; fixes in DECISIONS 060) |
| 6. Ship | ✅ Done (`reviews/phase-6.md` PASS WITH FIXES; fixes in DECISIONS 063) |

- Repo: https://github.com/Mooochew/offer-desk (public). Live: https://offer-desk-teal.vercel.app (Vercel auto-deploys `main`; Vercel deploys every push to `main`; CI is green).
- Supabase migrations 0001–0004 are applied. Phases 4–6 needed no new migration.
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

## What's left (user)

1. **Vercel:** `CRON_SECRET` must be set for Production. The user added it; they may switch it to "Sensitive" (delete and re-add it with the same value as `.env.local`). Check it in two ways:
   - `npm run check:live` asserts `cronConfigured`;
   - Vercel → Settings → Cron Jobs → **Run** on `/api/cron/warm` should log a 200.
2. **Record the demo** with `docs/DEMO.md`, rehearsing the same day. Don't run `check:agent`, `check:ui` or the evals that day.
3. **Upload** to YouTube (Unlisted) and **submit the Google Form** with the repo URL, the live URL and the video URL. Optionally, add the video link to the top of `README.md`.

## Phase 6 summary

- **UI polish** (DECISIONS 061):
  - an SVG icon set instead of emoji;
  - ink primary buttons, aligned panel headers and a hairline action log;
  - the Start here guide and funnel stat tiles;
  - arrow-key tabs.
- **Fixes** (DECISIONS 062):
  - hardware titles no longer match backend searches (N11);
  - source chips survive a reload (N1);
  - http(s)-only links (N4);
  - a limit on `/api/state` (N5);
  - Review reopens only live proposals (N9).
- **Daily cron:** `GET /api/cron/warm`, Bearer `CRON_SECRET`, at 14:00 UTC (`vercel.json`).
- **Docs:** the README, the PROMPTS "At a glance" summary, `docs/DEMO.md` and `docs/screenshots/`.
- **Review fixes** (DECISIONS 063):
  - `cronConfigured` in `/api/health`, asserted by `check:live`;
  - the composer focus ring;
  - a route test for `/api/state`;
  - accessibility and contrast nits.

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

- **Tests:** `npm run check`: 36 files, 411 tests; line coverage 98.9%, branch coverage 87.6% (floors 90/85).
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
