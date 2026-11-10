import { z } from "zod";
import boardsJson from "@/data/ats_boards.json";
import type { Board } from "./types";

const boardSchema = z.object({
  name: z.string().min(1),
  ats: z.enum(["greenhouse", "lever", "ashby"]),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  tags: z.array(z.string()),
});

/** All company boards, in "featured" order (well-known, high new-grad hiring first). */
export const ALL_BOARDS: Board[] = z.array(boardSchema).parse(boardsJson);

// Query words that point at a board tag.
const TAG_HINTS: [RegExp, string][] = [
  [/\b(ai|ml|machine learning|llm)\b/i, "ai"],
  [/\b(game|games|gaming)\b/i, "gaming"],
  [/\b(fintech|finance|payments|banking|crypto)\b/i, "fintech"],
  [/\b(data|analytics|database)\b/i, "data"],
  [/\b(security|infosec)\b/i, "security"],
  [/\b(infra|infrastructure|devops|cloud|platform)\b/i, "infra"],
  [/\b(dev ?tools|developer tools)\b/i, "devtools"],
  [/\b(health|healthcare|biotech)\b/i, "health"],
  [/\b(space|aerospace|defense)\b/i, "aerospace"],
];

const SOCAL_WORDS = /\b(socal|so cal|southern california|los angeles|la|irvine|san diego|santa monica|orange county)\b/i;

/** Tags a search should favor, from its query text and places. */
export function tagsFor(query: string, places: string[]): Set<string> {
  const tags = new Set<string>();
  for (const [pattern, tag] of TAG_HINTS) if (pattern.test(query)) tags.add(tag);
  if (places.some((place) => SOCAL_WORDS.test(place))) tags.add("socal");
  return tags;
}

/**
 * Picks up to `max` boards: boards matching more of the wanted tags first. Within the same
 * score, sources take turns (greenhouse, ashby, lever, ...) in featured order, so one source's
 * boards can't crowd out the others. Stable, so the same search hits the same (cached) boards.
 */
export function selectBoards(boards: readonly Board[], wantedTags: Set<string>, max: number): Board[] {
  const scored = boards.map((board, order) => ({ board, order, score: board.tags.filter((tag) => wantedTags.has(tag)).length }));
  const scores = [...new Set(scored.map((entry) => entry.score))].sort((a, b) => b - a);

  const selected: Board[] = [];
  for (const score of scores) {
    const queues = new Map<string, Board[]>();
    for (const entry of scored.filter((item) => item.score === score).sort((a, b) => a.order - b.order)) {
      queues.set(entry.board.ats, [...(queues.get(entry.board.ats) ?? []), entry.board]);
    }
    while ([...queues.values()].some((queue) => queue.length > 0)) {
      for (const queue of queues.values()) {
        const next = queue.shift();
        if (next) selected.push(next);
      }
    }
  }
  return selected.slice(0, max);
}
