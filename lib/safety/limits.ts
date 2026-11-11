import { createHmac } from "node:crypto";
import { QuotaExceededError } from "@/lib/llm/openai";

/** Atomic counter: adds one and returns the new count (increment_counter in Supabase). */
export type Counter = (key: string, ttlSeconds: number) => Promise<number>;

/** Limits from PLAN 4.9 and DECISIONS 003/018/040. Adjustable in one place. */
export const LIMITS = {
  chatPerSessionHour: 15,
  chatPerIpHour: 30,
  extractionsPerSessionHour: 75,
  extractionsPerIpHour: 150,
  /** All OpenAI requests per UTC day. */
  dailyRequests: 500,
  /** Extraction may use at most this much of the daily cap, so chat (routing) always has room. */
  dailyExtractionRequests: 400,
} as const;

const HOUR_S = 60 * 60;
const TWO_DAYS_S = 2 * 24 * HOUR_S;

export class RateLimitError extends Error {
  constructor(
    readonly scope: "session" | "ip",
    readonly retryAfterSeconds: number,
  ) {
    super(
      scope === "session"
        ? "You've sent a lot of requests this hour. Please wait a bit and try again."
        : "Too many requests from this network this hour. Please wait a bit and try again.",
    );
  }
}

export type Caller = { userId: string; ipHash: string };

function hourBucket(now: Date): string {
  return now.toISOString().slice(0, 13); // 2026-11-10T03
}

function secondsToNextHour(now: Date): number {
  return HOUR_S - Math.floor((now.getTime() / 1000) % HOUR_S);
}

/**
 * The client IP as Vercel reports it (first x-forwarded-for entry), or "unknown". Anyone can mint
 * anonymous sessions, so the per-IP limit is what actually bounds one person (DECISIONS 018).
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Keyed hash, so stored counter keys can't be reversed into IP addresses. */
export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}

/** Counts one chat request; throws RateLimitError past the per-session or per-IP hourly limit. */
export async function checkChatLimit(counter: Counter, caller: Caller, now = new Date()): Promise<void> {
  const hour = hourBucket(now);
  const session = await counter(`chat:user:${caller.userId}:${hour}`, 2 * HOUR_S);
  if (session > LIMITS.chatPerSessionHour) throw new RateLimitError("session", secondsToNextHour(now));
  const ip = await counter(`chat:ip:${caller.ipHash}:${hour}`, 2 * HOUR_S);
  if (ip > LIMITS.chatPerIpHour) throw new RateLimitError("ip", secondsToNextHour(now));
}

/** Counts one agent (routing) model request against the global daily cap. */
export function agentQuota(counter: Counter, now: () => Date = () => new Date()) {
  return async () => {
    const day = now().toISOString().slice(0, 10);
    if ((await counter(`openai:${day}`, TWO_DAYS_S)) > LIMITS.dailyRequests) throw new QuotaExceededError(LIMITS.dailyRequests);
  };
}

/**
 * Counts one extraction request: this session's and this IP's hourly budgets first (so a user who
 * is over their own limit doesn't burn the shared cap), then the extraction share of the daily cap,
 * then the daily cap itself. Triage can never use the slice reserved for chat.
 */
export function extractionQuota(counter: Counter, caller: Caller, now: () => Date = () => new Date()) {
  return async () => {
    const at = now();
    const hour = hourBucket(at);
    const day = at.toISOString().slice(0, 10);
    if ((await counter(`extract:user:${caller.userId}:${hour}`, 2 * HOUR_S)) > LIMITS.extractionsPerSessionHour) {
      throw new QuotaExceededError(LIMITS.extractionsPerSessionHour, "session");
    }
    if ((await counter(`extract:ip:${caller.ipHash}:${hour}`, 2 * HOUR_S)) > LIMITS.extractionsPerIpHour) {
      throw new QuotaExceededError(LIMITS.extractionsPerIpHour, "ip");
    }
    if ((await counter(`openai-extract:${day}`, TWO_DAYS_S)) > LIMITS.dailyExtractionRequests) throw new QuotaExceededError(LIMITS.dailyRequests);
    if ((await counter(`openai:${day}`, TWO_DAYS_S)) > LIMITS.dailyRequests) throw new QuotaExceededError(LIMITS.dailyRequests);
  };
}
