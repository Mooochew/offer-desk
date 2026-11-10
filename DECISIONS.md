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
