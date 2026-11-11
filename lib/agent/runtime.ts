import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import snapshot from "@/data/sample_postings.json";
import { validTimezone } from "@/lib/files/time";
import { getServerEnv } from "@/lib/env/server";
import { createResponder } from "@/lib/llm/openai";
import { loadBoards } from "@/lib/search/board-cache";
import { loadDescriptions } from "@/lib/search/descriptions";
import { searchJobs } from "@/lib/search/search-jobs";
import { loadSnapshotJobs } from "@/lib/search/snapshot";
import { createSupabaseStore } from "@/lib/search/supabase-store";
import { fetchBoard } from "@/lib/sources";
import type { Board } from "@/lib/sources/types";
import { agentQuota, extractionQuota, hashIp, type Caller, type Counter } from "@/lib/safety/limits";
import { createSupabaseExtractionStore } from "@/lib/triage/supabase-extraction-store";
import { triageJobs } from "@/lib/triage/triage";
import { CURRENT_EXTRACTION_PROMPT, CURRENT_SYSTEM_PROMPT } from "@/prompts";
import { createSupabaseAgentStore } from "./supabase-store";
import type { TurnDeps } from "./loop";
import { createRegistry } from "./tools/registry";
import type { AgentServices, ToolContext } from "./tools/types";

/**
 * Time budget for one agent turn (DECISIONS 031/040). `maxDuration` on the route is 300 s (the
 * Hobby maximum) as headroom; these keep a normal turn well under a minute:
 * - search + triage work must finish starting new work by WORK_MS (partial results after that);
 * - no new tool call starts after TOOLS_MS; the model then answers with what it has.
 */
export const WORK_MS = 40_000;
export const TOOLS_MS = 50_000;
/** Longest a live board refresh may run inside a turn; the rest is served stale and refreshed after. */
const SEARCH_BUDGET_MS = 15_000;
const BOARD_FETCH = { attempts: 2, timeoutMs: 5_000 } as const;
const DEFAULT_TIMEZONE = "America/Los_Angeles";

export function counterFor(admin: SupabaseClient): Counter {
  return async (key, ttlSeconds) => {
    const { data, error } = await admin.rpc("increment_counter", { counter_key: key, ttl_seconds: ttlSeconds });
    if (error) throw new Error(`counter failed: ${error.message}`);
    return data as number;
  };
}

export function callerFor(userId: string, ip: string): Caller {
  return { userId, ipHash: hashIp(ip, getServerEnv().supabaseSecretKey) };
}

/** Search and triage wired to Supabase, the job boards and OpenAI, with this caller's budgets. */
export function createServices(admin: SupabaseClient, caller: Caller, background: (task: () => Promise<void>) => void): AgentServices {
  const boardStore = createSupabaseStore(admin);
  const env = getServerEnv();
  const fetchWithinTurn = (board: Board) => fetchBoard(board, BOARD_FETCH);

  return {
    async search(criteria, deadline) {
      const budgetMs = Math.max(2_000, Math.min(SEARCH_BUDGET_MS, deadline - Date.now() - 20_000));
      const result = await searchJobs(criteria, {
        store: boardStore,
        fetchBoard: fetchWithinTurn,
        budgetMs,
        serveStale: true,
        loadSnapshot: () => loadSnapshotJobs(snapshot, boardStore),
      });
      if (result.staleBoards.length) {
        // Refresh expired boards after the response is sent, so the next search is fresh.
        background(async () => {
          await loadBoards(result.staleBoards, { store: boardStore, fetchBoard: fetchWithinTurn, budgetMs: 30_000 });
        });
      }
      return result;
    },

    triage(jobs, profile, filters, deadline) {
      return triageJobs(jobs, profile, filters, {
        create: createResponder({ countRequest: extractionQuota(counterFor(admin), caller) }),
        model: env.openaiExtractModel,
        prompt: CURRENT_EXTRACTION_PROMPT,
        store: createSupabaseExtractionStore(admin),
        loadDescriptions: (ids) => loadDescriptions(ids, { store: boardStore }),
        deadline,
      });
    },
  };
}

export type RequestContextInput = {
  admin: SupabaseClient;
  user: SupabaseClient;
  userId: string;
  ip: string;
  timezone?: string | null;
  background: (task: () => Promise<void>) => void;
  turnId?: string;
  startedAt?: number;
};

export function createToolContext(input: RequestContextInput): ToolContext {
  const startedAt = input.startedAt ?? Date.now();
  return {
    store: createSupabaseAgentStore(input.admin, input.user, input.userId),
    services: createServices(input.admin, callerFor(input.userId, input.ip), input.background),
    turnId: input.turnId ?? crypto.randomUUID(),
    now: () => new Date(),
    timezone: validTimezone(input.timezone) ?? DEFAULT_TIMEZONE,
    deadline: startedAt + WORK_MS,
  };
}

export const registry = createRegistry();

export function createTurnDeps(ctx: ToolContext, admin: SupabaseClient, caller: Caller, startedAt = Date.now()): TurnDeps {
  return {
    ctx,
    registry,
    create: createResponder({ countRequest: agentQuota(counterFor(admin), caller) }),
    model: getServerEnv().openaiModel,
    prompt: CURRENT_SYSTEM_PROMPT,
    toolDeadline: startedAt + TOOLS_MS,
  };
}
