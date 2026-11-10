// Phase 0 probe: hits each job source once and prints what the responses actually look like.
// Run: node scripts/probe-sources.ts   (Node 23.6+ runs TypeScript directly)
// Raw responses are saved to scripts/.out/ (gitignored).

import { mkdirSync, writeFileSync } from "node:fs";

const OUT_DIR = "scripts/.out";
mkdirSync(OUT_DIR, { recursive: true });

type ProbeResult = {
  name: string;
  url: string;
  status: number;
  ms: number;
  bytes: number;
  headers: Record<string, string>;
  body: unknown;
};

const INTERESTING_HEADERS = /rate|retry|limit|cache-control|content-type|server/i;

async function probe(name: string, url: string): Promise<ProbeResult> {
  const started = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  const ms = Date.now() - started;

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (INTERESTING_HEADERS.test(key)) headers[key] = value;
  });

  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON; keep the raw text
  }

  writeFileSync(`${OUT_DIR}/${name}.json`, text);
  return { name, url, status: response.status, ms, bytes: text.length, headers, body };
}

function kb(bytes: number) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function printHeader(result: ProbeResult) {
  console.log(`\n=== ${result.name} ===`);
  console.log(`GET ${result.url.replace(/app_key=[^&]+/, "app_key=***")}`);
  console.log(`status ${result.status} · ${result.ms} ms · ${kb(result.bytes)}`);
  console.log("headers", result.headers);
}

function sample(value: unknown, length = 160) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text?.slice(0, length);
}

async function probeGreenhouse(token: string) {
  const list = await probe(`greenhouse-${token}-list`, `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
  printHeader(list);
  const jobs = (list.body as { jobs?: any[] }).jobs ?? [];
  console.log(`jobs: ${jobs.length}`);
  if (!jobs.length) return;
  console.log("list job keys:", Object.keys(jobs[0]).sort().join(", "));
  console.log("location:", sample(jobs[0].location), "| updated_at:", jobs[0].updated_at, "| first_published:", jobs[0].first_published);

  const full = await probe(`greenhouse-${token}-full`, `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  console.log(`with content=true: ${kb(full.bytes)} (${(full.bytes / list.bytes).toFixed(1)}x the list) · ${full.ms} ms`);

  const one = await probe(`greenhouse-${token}-one`, `https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${jobs[0].id}`);
  const content = (one.body as { content?: string }).content ?? "";
  console.log(`single job: status ${one.status} · ${kb(one.bytes)} · content length ${content.length}`);
  console.log("content starts:", sample(content, 100));
}

async function probeLever(company: string) {
  const result = await probe(`lever-${company}`, `https://api.lever.co/v0/postings/${company}?mode=json`);
  printHeader(result);
  const postings = Array.isArray(result.body) ? result.body : [];
  console.log(`postings: ${postings.length}`);
  if (!postings.length) return;
  const first = postings[0];
  console.log("keys:", Object.keys(first).sort().join(", "));
  console.log("categories:", sample(first.categories));
  console.log("createdAt:", first.createdAt, "→", new Date(first.createdAt).toISOString(), "| workplaceType:", first.workplaceType);
  console.log("descriptionPlain length:", first.descriptionPlain?.length, "| lists:", sample(first.lists?.map((l: any) => l.text)));
}

async function probeAshby(board: string) {
  const result = await probe(`ashby-${board}`, `https://api.ashbyhq.com/posting-api/job-board/${board}`);
  printHeader(result);
  const jobs = (result.body as { jobs?: any[] }).jobs ?? [];
  console.log(`jobs: ${jobs.length}`);
  if (!jobs.length) return;
  const first = jobs[0];
  console.log("keys:", Object.keys(first).sort().join(", "));
  console.log("location:", first.location, "| isRemote:", first.isRemote, "| workplaceType:", first.workplaceType, "| publishedAt:", first.publishedAt);
  console.log("descriptionPlain length:", first.descriptionPlain?.length);
}

async function probeAdzuna() {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    console.log("\n=== adzuna ===\nskipped: ADZUNA_APP_ID / ADZUNA_APP_KEY not set");
    return;
  }
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: "20",
    what: "software engineer",
    where: "California",
  });
  const result = await probe("adzuna", `https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`);
  printHeader(result);
  const jobs = (result.body as { results?: any[] }).results ?? [];
  console.log(`results: ${jobs.length} · count: ${(result.body as any).count}`);
  if (!jobs.length) return;
  console.log("keys:", Object.keys(jobs[0]).sort().join(", "));
  const lengths = jobs.map((job) => job.description?.length ?? 0);
  console.log("description lengths:", lengths.join(", "));
  console.log("max length:", Math.max(...lengths), "| ends with:", sample(jobs[0].description?.slice(-40)));
}

async function main() {
  const tasks: [string, () => Promise<void>][] = [
    ["greenhouse stripe", () => probeGreenhouse("stripe")],
    ["greenhouse discord", () => probeGreenhouse("discord")],
    ["lever palantir", () => probeLever("palantir")],
    ["ashby ramp", () => probeAshby("ramp")],
    ["ashby nonexistent board", () => probeAshby("this-board-does-not-exist-123")],
    ["adzuna", probeAdzuna],
  ];

  for (const [label, task] of tasks) {
    try {
      await task();
    } catch (error) {
      console.log(`\n=== ${label} ===\nERROR: ${(error as Error).message}`);
    }
  }
}

main();
