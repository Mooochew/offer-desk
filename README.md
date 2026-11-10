# Offer Desk

A job-search triage agent for new-grad software engineers. You describe what you're looking for in plain English; the agent searches real job boards, reads each posting to find the actual requirements (years of experience, clearance, location), drops the fake "entry-level" ones, ranks the rest against your profile, and tracks your applications.

**Design rule:** the LLM routes and extracts; code computes. Filtering, scoring, deduping and counting are deterministic code, so the agent never invents job data or numbers.

> 🚧 Work in progress for CS4680 Prompt Engineering (Assignment 4: AI Agent Project). See [PLAN.md](PLAN.md) for the build plan and [DECISIONS.md](DECISIONS.md) for design decisions.

## Stack

Next.js (App Router, TypeScript) on Vercel · Supabase (Postgres, anonymous auth, Storage) · OpenAI function calling + Structured Outputs.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values.
3. Apply the SQL files in `supabase/migrations/` in order (Supabase Dashboard → SQL Editor).
4. `npm run dev`, then open http://localhost:3000.

Checks: `npm run check` (lint, types, tests, build), `npm run check:rls` (database security against your Supabase project), `npm run check:live` (the deployed site). See [TESTING.md](TESTING.md).
