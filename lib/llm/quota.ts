import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { QuotaCounterError, QuotaExceededError } from "./openai";

const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;

/**
 * Returns a counter that adds one OpenAI request to today's global total (UTC day) and throws
 * QuotaExceededError once `limit` is passed. Uses the atomic increment_counter function.
 */
export function createDailyQuota(admin: SupabaseClient, limit: number, now: () => Date = () => new Date()) {
  return async function countRequest(): Promise<void> {
    const day = now().toISOString().slice(0, 10);
    const { data, error } = await admin.rpc("increment_counter", { counter_key: `openai:${day}`, ttl_seconds: TWO_DAYS_SECONDS });
    if (error) throw new QuotaCounterError(error.message);
    if ((data as number) > limit) throw new QuotaExceededError(limit);
  };
}
