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
