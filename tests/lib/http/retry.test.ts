import { describe, expect, it } from "vitest";
import { fetchJson, HttpError, isRetryable, parseRetryAfter, retryDelayMs, withRetry } from "@/lib/http/retry";

const noSleep = { sleep: async () => {} };

/** A fake fetch that returns the queued responses in order and counts calls. */
function fakeFetch(responses: (() => Response | Promise<Response>)[]) {
  let calls = 0;
  const impl = (async () => {
    const next = responses[Math.min(calls, responses.length - 1)];
    calls++;
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () => new Response(JSON.stringify(body), { status, headers });

describe("withRetry", () => {
  it("retries a 429 and then succeeds", async () => {
    const fetch = fakeFetch([json({}, 429), json({ ok: true })]);
    const body = await fetchJson("https://api.test/x", { fetchImpl: fetch.impl, ...noSleep });
    expect(body).toEqual({ ok: true });
    expect(fetch.calls()).toBe(2);
  });

  it("retries 5xx up to the attempt limit, then throws the last HttpError", async () => {
    const fetch = fakeFetch([json({}, 503)]);
    const request = fetchJson("https://api.test/x", { fetchImpl: fetch.impl, attempts: 3, ...noSleep });
    await expect(request).rejects.toBeInstanceOf(HttpError);
    await expect(request).rejects.toMatchObject({ status: 503 });
    expect(fetch.calls()).toBe(3);
  });

  it("does not retry a 404 (a bad board slug won't fix itself)", async () => {
    const fetch = fakeFetch([json({}, 404)]);
    await expect(fetchJson("https://api.test/x", { fetchImpl: fetch.impl, ...noSleep })).rejects.toMatchObject({ status: 404 });
    expect(fetch.calls()).toBe(1);
  });

  it("retries network errors", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 2) throw new TypeError("fetch failed");
      return "done";
    }, noSleep);
    expect(result).toBe("done");
  });

  it("waits for Retry-After when the server sends it", async () => {
    const waits: number[] = [];
    const fetch = fakeFetch([json({}, 429, { "Retry-After": "2" }), json({})]);
    await fetchJson("https://api.test/x", { fetchImpl: fetch.impl, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([2000]);
  });
});

describe("retryDelayMs", () => {
  const settings = { attempts: 3, baseDelayMs: 400, maxDelayMs: 4000, random: () => 0.999 };

  it("grows exponentially with jitter below the ceiling", () => {
    expect(retryDelayMs(new Error("x"), 0, settings)).toBeLessThan(400);
    expect(retryDelayMs(new Error("x"), 2, settings)).toBeLessThan(1600);
    expect(retryDelayMs(new Error("x"), 2, settings)).toBeGreaterThan(1500);
  });

  it("caps Retry-After at the maximum delay", () => {
    expect(retryDelayMs(new HttpError(429, "https://a.test", 60_000), 0, settings)).toBe(4000);
  });
});

describe("isRetryable", () => {
  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [404, false],
  ])("status %i → %s", (status, expected) => {
    expect(isRetryable(new HttpError(status, "https://a.test"))).toBe(expected);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds", () => expect(parseRetryAfter("3")).toBe(3000));
  it("parses an HTTP date relative to now", () => {
    const now = Date.parse("2026-11-10T00:00:00Z");
    expect(parseRetryAfter("Tue, 10 Nov 2026 00:00:05 GMT", now)).toBe(5000);
  });
  it("returns null for missing or garbage values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});
