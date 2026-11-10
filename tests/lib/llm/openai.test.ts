import type { SupabaseClient } from "@supabase/supabase-js";
import { APIError } from "openai";
import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http/retry";
import { createResponder, QuotaExceededError, toHttpError } from "@/lib/llm/openai";
import { createDailyQuota } from "@/lib/llm/quota";

const params = { model: "m", input: "hi" };
const noSleep = { sleep: async () => {} };

describe("toHttpError", () => {
  it("converts SDK API errors, keeping status and Retry-After", () => {
    const sdkError = new APIError(429, { message: "slow down" }, "rate limited", new Headers({ "retry-after": "2" }));
    const converted = toHttpError(sdkError) as HttpError;
    expect(converted).toBeInstanceOf(HttpError);
    expect(converted.status).toBe(429);
    expect(converted.retryAfterMs).toBe(2000);
  });

  it("passes other errors through unchanged", () => {
    const network = new TypeError("fetch failed");
    expect(toHttpError(network)).toBe(network);
  });
});

describe("createResponder", () => {
  it("retries a rate-limited call and counts quota on every attempt", async () => {
    let attempts = 0;
    let counted = 0;
    const create = createResponder({
      ...noSleep,
      countRequest: async () => void counted++,
      send: async () => {
        attempts++;
        if (attempts === 1) throw new APIError(429, {}, "rate limited", new Headers());
        return { output_text: "ok" };
      },
    });
    expect(await create(params)).toEqual({ output_text: "ok" });
    expect(attempts).toBe(2);
    expect(counted).toBe(2);
  });

  it("does not retry a 400 (bad request won't fix itself)", async () => {
    let attempts = 0;
    const create = createResponder({
      ...noSleep,
      send: async () => {
        attempts++;
        throw new APIError(400, {}, "bad schema", new Headers());
      },
    });
    await expect(create(params)).rejects.toMatchObject({ status: 400 });
    expect(attempts).toBe(1);
  });

  it("never retries or calls the model once the daily quota is used up", async () => {
    let sends = 0;
    const create = createResponder({
      ...noSleep,
      countRequest: async () => {
        throw new QuotaExceededError(500);
      },
      send: async () => {
        sends++;
        return { output_text: "" };
      },
    });
    await expect(create(params)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(sends).toBe(0);
  });
});

describe("createDailyQuota", () => {
  function fakeAdmin(result: { data?: number; error?: { message: string } | null }) {
    const calls: unknown[][] = [];
    const admin = {
      rpc: async (...args: unknown[]) => {
        calls.push(args);
        return { data: null, error: null, ...result };
      },
    } as unknown as SupabaseClient;
    return { admin, calls };
  }

  it("counts against today's UTC key and allows calls up to the limit", async () => {
    const { admin, calls } = fakeAdmin({ data: 500 });
    await createDailyQuota(admin, 500, () => new Date("2026-11-10T23:59:00Z"))();
    expect(calls[0]).toEqual(["increment_counter", { counter_key: "openai:2026-11-10", ttl_seconds: 172800 }]);
  });

  it("throws QuotaExceededError past the limit", async () => {
    const { admin } = fakeAdmin({ data: 501 });
    await expect(createDailyQuota(admin, 500)()).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("fails closed when the counter can't be read", async () => {
    const { admin } = fakeAdmin({ error: { message: "db down" } });
    await expect(createDailyQuota(admin, 500)()).rejects.toThrow("quota counter failed: db down");
  });
});
