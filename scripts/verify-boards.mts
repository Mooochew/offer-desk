// Checks every board in data/ats_boards.json and reports dead or empty ones.
// Run before deploying: npm run boards:verify            (report only)
//                       npm run boards:verify -- --write (also removes dead boards from the file)

import { writeFileSync } from "node:fs";
import { ALL_BOARDS } from "@/lib/sources/boards";
import { fetchBoard } from "@/lib/sources";
import { boardKey } from "@/lib/sources/types";
import { mapWithConcurrency } from "@/lib/util/concurrency";

const write = process.argv.includes("--write");

const results = await mapWithConcurrency(ALL_BOARDS, 8, async (board) => {
  const jobs = await fetchBoard(board, { timeoutMs: 15_000 });
  return jobs.length;
});

const dead: string[] = [];
results.forEach((result, index) => {
  const board = ALL_BOARDS[index];
  if (!result.ok) {
    dead.push(boardKey(board));
    console.log(`✗ ${boardKey(board).padEnd(34)} ${(result.error as Error).message}`);
  } else if (result.value === 0) {
    dead.push(boardKey(board));
    console.log(`✗ ${boardKey(board).padEnd(34)} no open jobs`);
  }
});

const totalJobs = results.reduce((sum, result) => sum + (result.ok ? result.value : 0), 0);
console.log(`\n${ALL_BOARDS.length - dead.length}/${ALL_BOARDS.length} boards alive, ${totalJobs} open jobs in total.`);

if (write && dead.length) {
  const alive = ALL_BOARDS.filter((board) => !dead.includes(boardKey(board)));
  writeFileSync("data/ats_boards.json", JSON.stringify(alive, null, 2) + "\n");
  console.log(`Removed ${dead.length} board(s) from data/ats_boards.json.`);
}
