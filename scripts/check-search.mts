// Live check of the Phase 2 data layer: real job boards + real Supabase.
// Runs the demo search twice (second run must be served from cache), then loads descriptions
// for a few results, including Greenhouse ones fetched on demand.
// Writes to shared tables (postings, board_cache) by design: this also warms the cache.
// Run: npm run check:search   (.mts so tsx runs it as an ES module with top-level await)

import { createClient } from "@supabase/supabase-js";
import { loadDescriptions } from "@/lib/search/descriptions";
import { searchJobs } from "@/lib/search/search-jobs";
import { createSupabaseStore } from "@/lib/search/supabase-store";
import { fetchBoard } from "@/lib/sources";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});
const store = createSupabaseStore(admin);

let failures = 0;
function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
}

const criteria = {
  query: "entry-level backend and full-stack software engineer",
  places: ["socal"],
  remoteOk: true,
  postedWithinDays: 30,
};
const deps = { store, fetchBoard: (board: Parameters<typeof fetchBoard>[0]) => fetchBoard(board) };

let started = Date.now();
const first = await searchJobs(criteria, deps);
const firstMs = Date.now() - started;

console.log(`\nFirst search: ${firstMs} ms`);
console.table(first.sources);
console.log("Breakdown:", first.breakdown);
if (first.failures.length) console.log("Board failures:", first.failures.slice(0, 10));

check("first search finishes within 30 s", firstMs < 30_000, `${firstMs} ms`);
check("at least one source returned jobs", first.sources.some((source) => source.jobs > 0));
check("search returns matching jobs", first.jobs.length > 0, `${first.jobs.length} jobs`);
check("breakdown adds up", first.breakdown.considered -
  first.breakdown.droppedRole - first.breakdown.droppedSeniority - first.breakdown.droppedInternship -
  first.breakdown.droppedAge - first.breakdown.droppedLocation - first.breakdown.droppedDuplicates === first.breakdown.remaining);
check("no senior titles in results", !first.jobs.some((job) => /\b(senior|staff|principal|manager)\b/i.test(job.title)));

started = Date.now();
const second = await searchJobs(criteria, deps);
const secondMs = Date.now() - started;
const refreshedAgain = second.sources.reduce((sum, source) => sum + source.refreshed, 0);
console.log(`\nSecond search: ${secondMs} ms, boards refreshed again: ${refreshedAgain}`);
check("second search is served from cache", refreshedAgain === 0, `${refreshedAgain} refreshed`);
check("second search returns the same results", second.jobs.length === first.jobs.length);

console.log("\nTop 10:");
for (const job of first.jobs.slice(0, 10)) {
  console.log(`  ${job.postedAt?.slice(0, 10)}  ${job.company.padEnd(16)} ${job.title}  [${job.locations.join(" | ")}]`);
}

// Descriptions: pick some Greenhouse results (fetched on demand) and some others.
const sample = [
  ...first.jobs.filter((job) => job.source === "greenhouse").slice(0, 3),
  ...first.jobs.filter((job) => job.source !== "greenhouse").slice(0, 2),
];
const descriptions = await loadDescriptions(sample.map((job) => job.postingId), { store });
for (const job of sample) {
  const text = descriptions.get(job.postingId);
  check(`description loaded: ${job.source} ${job.company}`, Boolean(text && text.length > 200), `${text?.length ?? 0} chars`);
  if (text) check(`  description is plain text (no HTML tags)`, !/<\/?(p|div|li|ul|h\d)\b/i.test(text));
}

console.log(failures === 0 ? "\nSearch check passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
