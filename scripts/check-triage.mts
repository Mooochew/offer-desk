// Live check of Phase 3: real search → real extraction (OpenAI) → filters → scores, using the demo
// profile. The second run must be served entirely from the extraction cache (0 model calls).
// Counts against the app's daily OpenAI quota like real traffic.
// Run: npm run check:triage

import { createClient } from "@supabase/supabase-js";
import demoProfile from "@/data/demo_profile.json";
import { createDailyQuota } from "@/lib/llm/quota";
import { createResponder } from "@/lib/llm/openai";
import { profileSchema } from "@/lib/profile/types";
import { loadDescriptions } from "@/lib/search/descriptions";
import { searchJobs } from "@/lib/search/search-jobs";
import { createSupabaseStore } from "@/lib/search/supabase-store";
import { fetchBoard } from "@/lib/sources";
import { createSupabaseExtractionStore } from "@/lib/triage/supabase-extraction-store";
import { triageJobs } from "@/lib/triage/triage";
import { CURRENT_EXTRACTION_PROMPT } from "@/prompts";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const boardStore = createSupabaseStore(admin);
const profile = profileSchema.parse(demoProfile);
const model = process.env.OPENAI_EXTRACT_MODEL || "gpt-6-luna";

let failures = 0;
function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
}

const search = await searchJobs(
  { query: "entry-level backend and full-stack software engineer", places: profile.places, remoteOk: profile.remoteOk, postedWithinDays: 30 },
  { store: boardStore, fetchBoard: (board) => fetchBoard(board) },
);
console.log("Search breakdown:", search.breakdown);

const deps = {
  create: createResponder({ countRequest: createDailyQuota(admin, 500) }),
  model,
  prompt: CURRENT_EXTRACTION_PROMPT,
  store: createSupabaseExtractionStore(admin),
  loadDescriptions: (ids: string[]) => loadDescriptions(ids, { store: boardStore }),
};
const filters = { maxYears: profile.maxYears, excludeActiveClearance: true, excludeClearanceEligible: false };

let started = Date.now();
const first = await triageJobs(search.jobs, profile, filters, deps);
const firstMs = Date.now() - started;
console.log(`\nTriage 1: ${firstMs} ms, ${first.modelCalls} model calls, ${first.cacheHits} cache hits`);
console.log("Triage breakdown:", first.breakdown);

check("triage finishes within 45 s", firstMs < 45_000, `${firstMs} ms`);
check("some postings survive triage", first.ranked.length > 0, `${first.ranked.length}`);
check("breakdown adds up", first.breakdown.checked === first.breakdown.unread + first.breakdown.droppedYears + first.breakdown.droppedClearance + first.breakdown.remaining);
check("no ranked job needs more years than the profile allows", first.ranked.every((item) => (item.extraction.years_required_min ?? 0) <= profile.maxYears));
check("no ranked job needs an active clearance", first.ranked.every((item) => item.extraction.clearance_required !== "yes"));
check("every drop cites evidence", first.dropped.every((item) => Boolean(item.evidence)));
check("ranking is sorted by score", first.ranked.every((item, i, all) => i === 0 || all[i - 1].score.total >= item.score.total));

started = Date.now();
const second = await triageJobs(search.jobs, profile, filters, deps);
console.log(`\nTriage 2: ${Date.now() - started} ms, ${second.modelCalls} model calls, ${second.cacheHits} cache hits`);
check("second triage makes 0 model calls (cache)", second.modelCalls === 0, `${second.modelCalls}`);
check("second triage gives the same ranking", JSON.stringify(second.ranked.map((item) => item.job.postingId)) === JSON.stringify(first.ranked.map((item) => item.job.postingId)));

console.log("\nTop results:");
for (const item of first.ranked.slice(0, 10)) {
  console.log(`  ${String(item.score.total).padStart(3)}  ${item.job.company.padEnd(14)} ${item.job.title.slice(0, 55).padEnd(55)}  ${item.why}`);
}
console.log("\nDropped (with the evidence the code verified):");
for (const item of first.dropped.slice(0, 10)) {
  console.log(`  ${item.reason.padEnd(9)} ${item.job.company.padEnd(14)} ${item.job.title.slice(0, 45).padEnd(45)} "${item.evidence?.slice(0, 80)}"`);
}
if (first.unread.length) console.log("\nUnread:", first.unread.map((item) => `${item.job.company}: ${item.reason}`));

console.log(failures === 0 ? "\nTriage check passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
