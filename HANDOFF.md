# Handoff: Offer Desk (CS4680 Assignment 4)

Updated 2026-11-10 after **Phase 4 was built** (gate review pending). Read this first, then `PLAN.md` (phases), `DECISIONS.md` (001–053), `TESTING.md` (gate rules), `PROMPTS.md` (prompt-engineering write-up).

## Where we are

| Phase | Status |
|---|---|
| 0. Verify and set up | ✅ Done |
| 1. Foundation | ✅ Done (review: `reviews/phase-1.md`, fixes applied) |
| 2. Job data layer | ✅ Done (review: `reviews/phase-2.md`, fixes applied) |
| 3. Extraction and triage | ✅ Done (review: `reviews/phase-3.md` PASS WITH FIXES; fixes applied, check-6) |
| **4. Agent, tools, safety** | **Built; live check passes. Next: phase gate (deploy, live checks on the URL, independent review `reviews/phase-4.md`)** |
| 5. UI | Not started |
| 6. Ship | Not started |

- Repo: https://github.com/Mooochew/offer-desk (public). Live: https://offer-desk-teal.vercel.app (Vercel auto-deploys `main`).
- History was rewritten on 2026-11-10 to remove Claude co-author trailers (the user approved). A local tag `backup-before-rewrite` holds the old history.
- Supabase migrations 0001–0004 are applied (`npm run check:rls` passes).

## Working agreements (from the user)

- **Process per phase:** build independently → record every decision in `DECISIONS.md` with the reason, referencing the end goal → gate (tests per `TESTING.md`, `npm run check`, green CI, live checks, then a **fresh independent reviewer agent** following `.claude/agents/phase-reviewer.md`, writing `reviews/phase-N.md`) → one round of fixes → **stop** and report.
- **Commits: never add a `Co-Authored-By: Claude` line** (or any Claude attribution). Push after committing.
- The user prefers plain explanations. They confirm choices, but asked for independent work within a phase.

## Current eval numbers (check-6, 3 runs each, `gpt-6-luna`)

| Set | v1 | v2 (current prompt) |
|---|---|---|
| Held-out (12, never tuned, labeled blind) | 89.4% | **98.9%** |
| Tuning (16, in-sample) | 86.3% | 97.9% |

Live triage: 25/25 read, 0 unread.

## Phase 4 (agent)

- Code: `lib/agent/` (store interface + Supabase store, refs, executor + confirm flow, state, loop, runtime wiring, 15 tools in `tools/`), `lib/files/` (CSV, checklist, ICS, timezones), `lib/safety/limits.ts`. Routes: `/api/agent`, `/api/actions/[id]/confirm|reject`, `/api/demo/profile|seed`. Decisions 043–053.
- Agent prompt: `prompts/system-v3.ts` (v1 → v2 → v3 measured by `npm run eval:agent`; tuning v1 16/18 → v3 18/18, held-out 12/12 both).
- Live: `npm run check:agent` runs the demo script through the HTTP API (local: `npm run build && npm start`; deployed: `BASE_URL=... npm run check:agent`). Each run uses 6 chat turns; the per-IP limit is 30/hour (local runs share one IP key).
- On Windows, stopping a background `npm start` task can leave the Node process holding port 3000; kill it via `Get-NetTCPConnection -LocalPort 3000`.
- `npm run check`: 367 tests.

## Key facts for the next session

- **Stack:** Next.js 16.4 (App Router; read `node_modules/next/dist/docs/` before writing Next code, per `AGENTS.md`), Supabase (anonymous auth; Bearer-token auth to API routes, no `@supabase/ssr`), OpenAI Responses API, model `gpt-6-luna` for both agent and extraction.
- **Secrets:** `.env.local` (gitignored). Supabase keys use the new `sb_publishable_` / `sb_secret_` format. Never print values.
- **Scripts that import app code** run with `tsx --conditions=react-server`, as `.mts` files.
- **npm bug:** `npm install <pkg>` can drop rolldown platform bindings from the lockfile. If Vitest says "Cannot find native binding", delete `node_modules` and `package-lock.json` and reinstall.
- **Vitest 5 quirk:** a rejecting `vi.fn()` inside a `vi.mock` factory fails tests even when caught; use plain fake functions.
- **Shell:** Windows Git Bash. Heredocs with non-ASCII or nested quotes break, so write Python edit scripts to a file and run them with `PYTHONIOENCODING=utf-8`. Scratch scripts go in `scripts/.out/` (gitignored).
- **Data:** 145 company boards (`data/ats_boards.json`), 120-posting snapshot (`data/sample_postings.json`), demo profile (`data/demo_profile.json`). Cursor's live Ashby board serves SpaceX text (an upstream issue, not our bug).
- **Live checks:** `npm run check:rls | check:live | check:search | check:triage`. Prompt eval: `npm run eval -- <version> <runs> <tuning|holdout>`.
