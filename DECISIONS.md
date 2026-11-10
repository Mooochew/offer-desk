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
