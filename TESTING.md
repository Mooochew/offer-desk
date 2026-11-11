# Testing Standards

Every phase ends at a **gate** (see [PLAN.md](PLAN.md#phase-gate)). A phase is not done until every step of its gate passes.

## The layers

| Layer | What it covers | Command | Runs where |
|---|---|---|---|
| **Static** | Lint + types | `npm run lint`, `npm run typecheck` | Local + CI |
| **Unit** | Deterministic code (normalizers, dedupe, filters, scoring, validators, tool executor, confirmation flow, file builders) | `npm test` | Local + CI |
| **Coverage** | Floors on `lib/**`: 90% lines, 90% functions, 85% branches (raised from 80/80/75 after Phase 2) | `npm run test:coverage` | Local + CI |
| **Build** | Production build succeeds | `npm run build` | Local + CI |
| **Live checks** | Real Supabase, real job boards, real OpenAI and the deployed URL: RLS isolation, session flow, a full search (cold + cached), triage with extraction (first run + cached rerun with 0 model calls), and the demo script through the agent API with confirmation and cross-user probes | `npm run check:rls`, `npm run check:live`, `npm run check:search`, `npm run check:triage`, `npm run check:agent` and `npm run check:ui` (need a running server or `BASE_URL`; `check:ui` drives the installed Edge/Chrome) | Local, at each gate |
| **Data checks** | Board registry still alive; snapshot and eval files valid and consistent | `npm run boards:verify` (local), `tests/data/*` (CI) | Local + CI |
| **Prompt evals** | LLM extraction accuracy per field against 16 audited labels (+12 held-out), mean and min–max over 3 runs, next to the trivial baseline; agent routing: what the model did on fixed scenarios (tools, refs, arguments) | `npm run eval -- <version> 3 <tuning\|holdout>`, `npm run eval:agent -- <version> 3 <tuning\|holdout>` | Local, when a prompt or the answer checks change |
| **Independent review** | Architecture, test quality, assignment alignment | Phase reviewer agent | At each gate |

`npm run check` runs static + unit + coverage + build in one command. CI (`.github/workflows/ci.yml`) runs the same steps on every push to `main`.

## Rules

1. **Unit tests never touch the network or real services.** Supabase, OpenAI and job APIs are faked. Source normalizers are tested against small **recorded fixtures** saved from real responses (`tests/fixtures/`), so a test proves we handle what the API actually returns.
2. **Test behavior, not implementation.** Test names say what must be true ("rejects a token Supabase does not accept"), so a failing test explains itself.
3. **Every safety rule has a test that tries to break it.** For example: a destructive tool can't run without a confirmation record, an unknown ref is rejected, another session's ref is rejected, a secret key in a public variable fails config validation.
4. **Every bug fix adds a test** that would have caught it. (Example: the missing `service_role` grants are now covered by `check:rls`.)
5. **The LLM's output is untrusted input.** Validators are tested with malformed, partial and hostile LLM output, not just happy paths.
6. **Live checks clean up after themselves.** Test users and rows they create are deleted at the end.
7. **Prompt changes need numbers.** A change to an extraction or system prompt is run through the eval, and before/after scores go in PROMPTS.md.
8. **No skipped or `.only` tests are committed**, and coverage floors are never lowered to make a gate pass.

## Layout

```
tests/
  lib/        unit tests mirroring lib/ (e.g. lib/triage/filter.ts → tests/lib/triage/filter.test.ts)
  api/        route handler tests with faked dependencies
  fixtures/   trimmed real API responses
  stubs/      stand-ins for modules that can't load in tests (e.g. server-only)
scripts/      live checks (check-*.ts, smoke-live.ts) and one-off tools
evals/        labeled data for prompt evals
```

## Known quirks

- **Vitest 5 + rejecting `vi.fn()` in a mocked module.** A `vi.fn()` that rejects inside a `vi.mock(...)` factory fails the test even when the code under test catches the error. For "this dependency fails" cases, use a plain function with a settable implementation (see `tests/api/health.test.ts`).
- **`npm` optional dependency bug.** If Vitest says "Cannot find native binding" (rolldown), delete `node_modules` and `package-lock.json` and run `npm install` again. Don't add the platform binary as a direct dependency, because CI runs on Linux. **`npm install <package>` can trigger this** by dropping the platform entries from the lockfile (it happened when adding `tsx`). After adding a dependency, check `grep -c '"node_modules/@rolldown/binding-' package-lock.json` is 15 (the shorter pattern `@rolldown/binding-` also matches rolldown's own dependency list, so it stays non-zero even when every platform entry is gone; that false all-clear happened in Phase 5). If the entries are gone, restore the lockfile from git and add only the new package's entry, then `npm ci` with the dev server stopped (Windows locks files in `node_modules`).
