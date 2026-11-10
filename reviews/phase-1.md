# Phase 1 Review (covers Phase 0 and Phase 1)

**Verdict:** PASS WITH FIXES
(Nothing blocks Phase 2. Two "should fix" items, S1 and S2, must be closed before Phase 4/5 starts, because the code for those phases will depend on them.)

## Commands run
- `npm run check`: **passes**. Lint: 0 errors, 2 warnings (both in the generated `coverage/` folder, see N1). Typecheck OK. Vitest: 3 files, 17 tests passed. Coverage on `lib/**`: 100% statements/branches/functions/lines (20/20/4/17), but that covers only `lib/env.ts` and `lib/supabase/server.ts`, since `browser.ts` is excluded. `next build` OK: `/` static, `/api/health` dynamic.
- `npm run check:rls`: **14/14 passed**. Own-row CRUD on `profiles`, cross-user read/update/insert blocked, `action_log` insert refused (42501), all 5 shared tables refused (42501), `increment_counter` refused for users and working for the server, `exports` bucket private. Test users are deleted afterwards.
- `npm run check:live`: **6/6 passed** against https://offer-desk-teal.vercel.app. Home page 200 with the right title, two anonymous sessions accepted and distinct, no token gives 401.
- `gh run list --limit 3`: one run, `success`, for HEAD `36e049e` ("Add testing standards, CI, ...").
- Manual checks against the live URL: `GET /api/health` gives 405, and `POST` with a garbage bearer token gives 401 `Invalid or expired session`.
- Secret scan: `git log -p --all` has 0 matches for `sb_secret_…`/`sk-…` patterns. I downloaded all 7 JS chunks of the live page: 0 secret-key matches; the publishable key is present (expected). **However**, the server env zod schema (`supabaseSecretKey: …startsWith("sb_secret_")`) ships in the browser bundle (see S3).
- `.env.local`: confirmed ignored (`.gitignore:11`) and never committed. Adzuna keys are empty. No values were printed.
- `gh api …/deployments` returned nothing and there is no local `.vercel/`, so **unverified**: that Vercel auto-deploys from GitHub (PLAN §3) and that production equals HEAD. The live page's `Age` header suggests a deploy a few minutes after the last push.

## Assignment alignment
| Requirement | Status | Where / notes |
|---|---|---|
| LLM integration: send/receive | planned | No `lib/llm/` yet. Model chosen and tested in Phase 0 (DECISIONS 009/010); `getServerEnv()` validates key + models |
| LLM: API errors, rate limiting | planned | `counters` table + atomic `increment_counter` RPC exist and are tested live; retry/backoff not built (Phase 2/4) |
| Parse LLM output into commands | planned | zod is installed; tool registry is Phase 4 |
| Convert to executable operations | planned | Phase 4 |
| Multiple domains (API, DB, files) | in progress | DB schema + private Storage bucket done; source APIs probed (DECISIONS 004); clients are Phase 2 |
| UI: natural-language input | planned | `app/page.tsx` has placeholder panels only |
| UI: results / execution status / feedback | in progress | Three-panel shell + session status chip; nothing else yet |
| Validate LLM output | planned | Phase 3 (extraction) / Phase 4 (tool args) |
| Graceful errors | in progress | `/api/health` maps 401/500 correctly; there is no app-wide pattern yet |
| Confirmation for destructive ops | in progress | `action_log` statuses, `resolved_args`, `preview`, `expires_at` are in place, and users can't write the log (verified live). Endpoints are Phase 4 |
| Audit log of all actions | in progress | `action_log` table + RLS read-own policy done; writes are Phase 4 |
| Deliverable: public GitHub repo | done | github.com/Mooochew/offer-desk, public, CI green |
| Deliverable: deployed URL strangers can use | done (shell) | Live, with anonymous sessions per visitor (smoke test) |
| Deliverable: 1–2 min demo video | planned | Phase 6; script in PLAN §9 is 90 s, which fits |

## Findings

### Blocking
None.

### Should fix

**S1. User-writable `files` and `refs` tables plus a secret-key Storage client lead to cross-user file access in Phase 4.**
`supabase/migrations/0001_init.sql:238-241` grants `insert, update, delete` on `refs`, `files`, `result_sets` and `messages` to `authenticated`. Every visitor holds their own access token in localStorage and the publishable key, so they can call PostgREST directly and bypass the agent. RLS keeps each user to their own rows, but it does not check the *contents* of those rows:
- A user can insert a `files` row whose `storage_path` points at another user's object. The migration's own design (`0001_init.sql:267-269`) is that "the server uploads with the secret key and hands out short-lived signed URLs". If the Phase 4 download or `delete_files` code trusts `files.storage_path`, the server will sign or delete **another user's file**.
- A user can insert `refs` rows with any `target_id`. RLS on `applications` still protects user data when the server uses the user-scoped client, but any lookup that goes through the admin client (postings, files, storage) trusts that mapping.
- A user can insert `messages` with `role = 'system'`, which injects a "system note" into their own context. The risk is low, but it weakens the PLAN 4.5 design where system notes record confirm/cancel outcomes.

Why it matters: "refs must exist and belong to the session" (PLAN §1) is a core safety claim. The rubric's 30% design score and the safety requirement depend on it holding against a curious grader.

Fix: grant only `select` to `authenticated` on `refs`, `files`, `result_sets` and `messages` (the same rule `action_log` already follows), and write them on the server with an explicit `user_id`. Independently, build storage paths as `${user_id}/…`, and before signing or deleting, assert that the path starts with the caller's id. Add checks to `check:rls`: a user cannot insert into `files`/`refs`/`messages`. Record the choice in DECISIONS.

**S2. Concurrent first-load calls can create several anonymous users.**
`lib/supabase/browser.ts:15-25`: `getAccessToken()` calls `getSession()` and, if it finds none, calls `signInAnonymously()`. Nothing deduplicates calls that are already in flight. React StrictMode in dev runs the `SessionStatus` effect twice. In Phase 5, several panels (action log, pipeline, profile) will each call `authedFetch` on mount. On a fresh visit, each call can mint its own anonymous user, and the user whose session wins localStorage may not be the one that owns the rows another panel just created. It looks like "my profile vanished", which is exactly the kind of bug that breaks a live demo. **Unverified** whether supabase-js's internal auth lock serializes this; don't rely on it.

Fix: keep a module-level `let pending: Promise<string> | null` so all callers share one sign-in. Remove `browser.ts` from the coverage `exclude` (`vitest.config.mts:21`) and unit-test with a mocked `createClient`: an existing session is reused; two concurrent calls lead to exactly one `signInAnonymously`; a sign-in error throws a readable message. Right now, the session flow every route will rely on has zero unit tests.

**S3. Server env schema is bundled into client JS.**
`lib/env.ts` exports both `publicEnv` and `getServerEnv`. `lib/supabase/browser.ts:2` imports it, so the server schema (including the `sb_secret_` check) ships to the browser. I confirmed this in the live chunks. No secret leaks today, because non-`NEXT_PUBLIC_` vars are not inlined. But nothing stops a client component from calling `getServerEnv()` later, and `server.ts` is the only `server-only` guard. Fix: split into `lib/env/public.ts` and `lib/env/server.ts`, with `import "server-only"` in the server file.

**S4. Admin-client rule contradicts the schema.**
`lib/supabase/server.ts:19-22` says the admin client is "Only for shared tables … Never use it for user-owned data". But `action_log` is user-owned and users cannot write it (`0001_init.sql:242`), so the server *must* write audit rows with the admin client. If S1 is adopted, the same goes for `refs`/`files`/`messages`. Phase 4 will either break this rule silently or route around it badly. Fix: reword the rule to "admin client for shared tables and server-authored rows; always set `user_id` from `requireUser`, never from model or request input". Consider a small `lib/db/audit.ts` helper that takes the verified user as an argument, so it's the only path that writes those rows.

**S5. Schema drift that DECISIONS doesn't record.**
PLAN §4.3 (`PLAN.md:145`, `PLAN.md:158`) defines `quota` and `rate_limits` tables. The migration replaces both with one `counters` table plus `increment_counter`. `extractions` also changed: from "posting_id, description_hash (unique)" to a composite primary key `(description_hash, prompt_version, model)`. Both changes are improvements (the composite key makes the v1→v2 eval cache-safe), but neither is in DECISIONS.md, and PLAN still describes the old tables. Fix: add DECISIONS 016 and update PLAN §4.3/§4.9.

**S6. Phase 1 scope item silently not done: shadcn/ui.**
PLAN.md:336 (Phase 1 step 1) and D8 call for shadcn/ui. There is no `components.json` or `components/ui/`, and no lucide/Recharts. Either install it now (it's cheap, and Phase 5's modal/tabs/toasts depend on it) or record that it was dropped.

**S7. `check:rls` covers one user table and doesn't test the 0003 fix directly.**
`scripts/check-rls.ts:30-45` tests isolation only on `profiles`. The other six user tables use the same policy text, but a typo in any one of them would go unnoticed. TESTING rule 4 says the 0003 `service_role` grant fix is "covered by check:rls". In fact only the RPC path is checked: the cleanup `admin.from("counters").delete()` at line 73 ignores its result, and nothing checks that the admin client can write `postings` or `action_log`. Also, lines 56-59 accept "zero rows" as a pass on empty tables, so that check could pass even if the grants were wide open (today it passes on a real 42501, which is good). Fix:
- loop the isolation checks over all user tables;
- add admin insert/select/delete on `postings` and an admin insert on `action_log`, and assert both succeed;
- make the shared-table check require an error;
- put cleanup in `try/finally` so a mid-run failure doesn't leave test users behind.

### Nice to have
- **N1.** `eslint.config.mjs:15-21`: add `coverage/**` to `globalIgnores`. Locally, `npm run check` lints the generated coverage HTML from the previous run (the 2 warnings).
- **N2.** `app/api/health/route.ts:14` returns raw `error.message` on 500. That's fine for health, but don't copy the pattern into `/api/agent`: return a generic message and log the detail.
- **N3.** The live smoke test never calls `getServerEnv()` or `createAdminSupabase()`, so it doesn't prove Vercel has `SUPABASE_SECRET_KEY`/`OPENAI_API_KEY` set (**unverified**). Have `/api/health` also run `getServerEnv()` and return `serverEnvOk: true`, never the values.
- **N4.** `counters` rows have `expires_at`, but nothing deletes them. The keys are time-bucketed, so counts stay correct; the table just grows. Add a periodic `delete … where expires_at < now()` (for example inside `increment_counter`).
- **N5.** Per-session limits can be bypassed by minting new anonymous sessions (Supabase's anonymous sign-in rate limit is per IP). The migration comment (`0001_init.sql:83`) mentions `ip:<hash>` keys, but PLAN §4.9 doesn't. Decide whether to add a per-IP limit; the global 500/day cap already bounds cost.
- **N6.** Stale docs:
  - `PLAN.md:3` still says "draft, waiting for confirmation", even though the decisions were confirmed;
  - `README.md:15` says "Setup: Coming in Phase 1";
  - `PLAN.md:229` says Adzuna 150/day while §4.9 and DECISIONS 003 say 100.
- **N7.** Phase 0 left Adzuna untested (DECISIONS 004 "waiting on a key"; `.env.local` has no Adzuna keys). Adzuna is optional, so this is fine, but write "Adzuna deferred/dropped" in DECISIONS so PLAN's Phase 0 "confirm truncation" item is closed rather than dangling.
- **N8.** Phase 4 design notes the schema should anticipate:
  - confirm must be an atomic conditional update (`update … set status='confirmed' where id=$1 and user_id=$2 and status='awaiting_confirmation' and expires_at > now() returning *`) so a double-click can't execute twice;
  - short-ref numbering (`J1…`) needs a per-user atomic counter (`increment_counter('ref:<user>:J')` works) to avoid duplicate-key races.

## Testing assessment
- Unit tests are behavior-named and include real failure paths: a secret key in the public var, a publishable key in the secret var, a missing OpenAI key, a non-Bearer header, a token Supabase rejects, and 500 vs 401 mapping. They mock supabase-js and make no network calls (verified by reading). There are no `.only`/`.skip` (grep found none), and the coverage floors match TESTING.md.
- The 100% coverage figure is real but narrow: there are 17 statements of server code, and the one piece of client logic with branching (`browser.ts`) is excluded (S2).
- The live checks are the strongest part of this phase. They actually ran green against real Supabase and the deployed URL, and they clean up their users. Their main gap is breadth (S7).
- There are no fixtures yet (`tests/fixtures/` is missing). The raw probe responses are in gitignored `scripts/.out/`. Phase 2 should commit *trimmed* fixtures derived from them, as TESTING rule 1 requires.
- `health.test.ts` uses a hand-rolled fake and a `calls` counter to work around a documented Vitest 5 quirk. That's acceptable and explained.

## Risks to the end goal
1. **Day 2 is overloaded.** Phases 3+4+5+6 add up to about 13 h on one day. They hold all of the prompt-engineering score (20%), most of design (30%), all of UI (10%) and the demo (30%). Phase 1 ran on schedule, but there is no slack. Mitigations:
   - start the extraction eval labeling during Phase 2: snapshot postings early and draft the labels while the data layer is fresh;
   - write the cut order (PLAN §6) into the Phase 4 checkpoint so the cut decision is made by mid-day 2, not at 10 pm.
2. **Prompt engineering is still 0% built.** It's the second-heaviest graded item that depends on unique work. The v1→v2 eval with numbers is the evidence for it; protect it, as the plan already says ("never cut").
3. **Demo robustness:**
   - the live demo depends on 40 boards responding within 60 s and on the snapshot fallback;
   - the 500/day global OpenAI cap can be exhausted by a stranger before grading. Consider a separate, higher reserve for the demo session or a manual reset path.
4. **Safety claims vs reality.** The assignment explicitly grades validation and confirmation. S1 and S4 are where a grader probing the public URL could find a hole. Fix them before the Phase 4 executor is written, not after.

## What's done well (verified)
- RLS is on for all 12 tables. Shared tables are fully revoked from `anon`/`authenticated`, and `action_log` is read-only to users. The live run confirmed this: 42501 on every forbidden path.
- Explicit grants (0002/0003) came from a real failure the RLS script caught, and are documented in DECISIONS 015. That's the right loop.
- Bearer-token auth (DECISIONS 013) is sound for this app. Tokens are verified server-side with `auth.getUser` (not just decoded), and the user client is scoped to the token, so RLS applies. Live: no token or a fake token gives 401.
- No secrets are in git history or in the live JS bundle. `.env*` is ignored, and the publishable/secret key prefixes are validated by zod, with tests that try to swap them.
- The extraction cache key includes prompt version + model. That stops a stale cache from silently corrupting the v1→v2 eval.
- Phase 0 produced concrete, decision-driving findings rather than boilerplate: Greenhouse 12.5x content blow-up → two-pass fetch; Lever requirements in `lists[]`; Ashby `isRemote`/`workplaceType` conflict; The Muse 403. The model was chosen from measured token usage, not from a pricing page.
- CI mirrors `npm run check` and is green on HEAD.
