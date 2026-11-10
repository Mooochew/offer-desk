import type { FetchJsonOptions } from "@/lib/http/retry";
import { fetchAshbyBoard } from "./ashby";
import { fetchGreenhouseBoard } from "./greenhouse";
import { fetchLeverBoard } from "./lever";
import type { Board, NormalizedJob, SourceName } from "./types";

export type BoardFetcher = (board: Board, options?: FetchJsonOptions) => Promise<NormalizedJob[]>;

export const boardFetchers: Record<SourceName, BoardFetcher> = {
  greenhouse: fetchGreenhouseBoard,
  lever: fetchLeverBoard,
  ashby: fetchAshbyBoard,
};

export function fetchBoard(board: Board, options?: FetchJsonOptions): Promise<NormalizedJob[]> {
  return boardFetchers[board.ats](board, options);
}
