export type SourceName = "greenhouse" | "lever" | "ashby";
export type RemoteType = "onsite" | "hybrid" | "remote" | "unknown";

/** One company job board, from data/ats_boards.json. */
export type Board = {
  name: string;
  ats: SourceName;
  slug: string;
  tags: string[];
};

/** A job normalized from any source. `description` may be null until fetched (Greenhouse). */
export type NormalizedJob = {
  source: SourceName;
  sourceId: string;
  company: string;
  title: string;
  /** Primary location as the source wrote it. */
  location: string | null;
  /** Every location the job is open in (primary first). */
  locations: string[];
  remote: RemoteType;
  url: string;
  postedAt: string | null;
  employmentType: string | null;
  description: string | null;
  /** Small subset of source fields kept for debugging; never descriptions. */
  raw: Record<string, unknown>;
};

/** Light entry kept in the per-board cache: no description, plus the stored posting's id. */
export type BoardJob = Omit<NormalizedJob, "description" | "raw"> & { postingId: string };

export function boardKey(board: Pick<Board, "ats" | "slug">): string {
  return `${board.ats}:${board.slug}`;
}
