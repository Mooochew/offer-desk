// Saves a snapshot of real new-grad-relevant postings (with full descriptions) to
// data/sample_postings.json. Used for the demo seed, the search fallback, and the extraction eval.
// Run: npm run snapshot

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { loadDescriptions } from "@/lib/search/descriptions";
import { searchJobs } from "@/lib/search/search-jobs";
import type { SnapshotJob } from "@/lib/search/snapshot";
import { createSupabaseStore } from "@/lib/search/supabase-store";
import { fetchBoard } from "@/lib/sources";
import { ALL_BOARDS } from "@/lib/sources/boards";

const MAX_JOBS = 120;
const MAX_PER_COMPANY = 6;
const MAX_DESCRIPTION_CHARS = 12_000;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const store = createSupabaseStore(admin);

// Broad search across every board: any software role, US places + remote, last 60 days.
const result = await searchJobs(
  { query: "software engineer", places: ["socal", "bay area", "nyc", "seattle"], remoteOk: true, postedWithinDays: 60 },
  { store, fetchBoard: (board) => fetchBoard(board), maxBoards: ALL_BOARDS.length, budgetMs: 120_000 },
);
console.log(`Search: ${result.jobs.length} jobs`, result.breakdown);

// Spread across companies so the snapshot isn't dominated by one big board.
const perCompany = new Map<string, number>();
const picked = result.jobs.filter((job) => {
  const count = perCompany.get(job.company) ?? 0;
  if (count >= MAX_PER_COMPANY) return false;
  perCompany.set(job.company, count + 1);
  return true;
}).slice(0, MAX_JOBS);

const descriptions = await loadDescriptions(picked.map((job) => job.postingId), { store });
const boardByCompany = new Map(ALL_BOARDS.map((board) => [`${board.ats}:${board.name}`, board]));

const jobs: SnapshotJob[] = picked.flatMap((job) => {
  const description = descriptions.get(job.postingId);
  const board = boardByCompany.get(`${job.source}:${job.company}`);
  if (!description || !board) return [];
  return [{
    boardName: board.name,
    boardSlug: board.slug,
    source: job.source,
    sourceId: job.sourceId,
    company: job.company,
    title: job.title,
    location: job.location,
    locations: job.locations,
    remote: job.remote,
    url: job.url,
    postedAt: job.postedAt,
    employmentType: job.employmentType,
    description: description.slice(0, MAX_DESCRIPTION_CHARS),
  }];
});

writeFileSync("data/sample_postings.json", JSON.stringify({ takenAt: new Date().toISOString(), jobs }, null, 1) + "\n");
console.log(`Saved ${jobs.length} postings from ${new Set(jobs.map((job) => job.company)).size} companies to data/sample_postings.json`);
