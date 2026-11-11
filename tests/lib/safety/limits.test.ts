import { describe, expect, it } from "vitest";
import { QuotaExceededError } from "@/lib/llm/openai";
import { agentQuota, checkChatLimit, checkStateLimit, clientIp, extractionQuota, hashIp, LIMITS, RateLimitError, type Counter } from "@/lib/safety/limits";

function memoryCounter(start: Record<string, number> = {}) {
  const counts = new Map(Object.entries(start));
  const counter: Counter = async (key) => {
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next;
  };
  return { counter, counts };
}

const NOW = new Date("2026-11-10T03:20:00Z");
const caller = { userId: "u1", ipHash: "iphash" };

describe("chat rate limit (DECISIONS 018)", () => {
  it(`allows ${LIMITS.chatPerSessionHour} requests per session per hour, then refuses with retry-after`, async () => {
    const { counter } = memoryCounter();
    for (let i = 0; i < LIMITS.chatPerSessionHour; i++) await checkChatLimit(counter, caller, NOW);
    const error = await checkChatLimit(counter, caller, NOW).catch((caught) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ scope: "session", retryAfterSeconds: 40 * 60 });
  });

  it("limits per IP across freshly minted sessions", async () => {
    const { counter } = memoryCounter({ [`chat:ip:iphash:2026-11-10T03`]: LIMITS.chatPerIpHour });
    await expect(checkChatLimit(counter, { userId: "brand-new", ipHash: "iphash" }, NOW)).rejects.toMatchObject({ scope: "ip" });
  });

  it("starts fresh in the next hour", async () => {
    const { counter } = memoryCounter({ "chat:user:u1:2026-11-10T03": 99 });
    await expect(checkChatLimit(counter, caller, new Date("2026-11-10T04:00:00Z"))).resolves.toBeUndefined();
  });
});

describe("AI budgets (DECISIONS 040)", () => {
  it("caps one session's extraction calls per hour without touching the shared daily cap", async () => {
    const { counter, counts } = memoryCounter({ "extract:user:u1:2026-11-10T03": LIMITS.extractionsPerSessionHour });
    await expect(extractionQuota(counter, caller, () => NOW)()).rejects.toMatchObject({ scope: "session" });
    expect(counts.has("openai:2026-11-10")).toBe(false);
  });

  it("caps one network's extraction calls per hour", async () => {
    const { counter } = memoryCounter({ "extract:ip:iphash:2026-11-10T03": LIMITS.extractionsPerIpHour });
    await expect(extractionQuota(counter, caller, () => NOW)()).rejects.toMatchObject({ scope: "ip" });
  });

  it("keeps part of the daily cap for chat: extraction stops at its share, agent calls continue", async () => {
    const { counter } = memoryCounter({ "openai-extract:2026-11-10": LIMITS.dailyExtractionRequests, "openai:2026-11-10": LIMITS.dailyExtractionRequests });
    await expect(extractionQuota(counter, caller, () => NOW)()).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(agentQuota(counter, caller, () => NOW)()).resolves.toBeUndefined();
  });

  it("stops everything at the daily cap", async () => {
    const { counter } = memoryCounter({ "openai:2026-11-10": LIMITS.dailyRequests });
    await expect(agentQuota(counter, caller, () => NOW)()).rejects.toMatchObject({ scope: "daily" });
    await expect(extractionQuota(counter, caller, () => NOW)()).rejects.toMatchObject({ scope: "daily" });
  });

  it("counts an allowed extraction against every budget", async () => {
    const { counter, counts } = memoryCounter();
    await extractionQuota(counter, caller, () => NOW)();
    expect([...counts.keys()].sort()).toEqual(["extract:ip:iphash:2026-11-10T03", "extract:user:u1:2026-11-10T03", "openai-extract:2026-11-10", "openai-ip:iphash:2026-11-10", "openai:2026-11-10"]);
  });

  // Phase 4 review S1: a chat turn can make several model calls, so calls are budgeted, not just turns.
  it("caps agent model calls per session and per IP per hour, before the shared cap is touched", async () => {
    const session = memoryCounter({ "agent:user:u1:2026-11-10T03": LIMITS.agentCallsPerSessionHour });
    await expect(agentQuota(session.counter, caller, () => NOW)()).rejects.toMatchObject({ scope: "session" });
    expect(session.counts.has("openai:2026-11-10")).toBe(false);
    const ip = memoryCounter({ "agent:ip:iphash:2026-11-10T03": LIMITS.agentCallsPerIpHour });
    await expect(agentQuota(ip.counter, { userId: "fresh", ipHash: "iphash" }, () => NOW)()).rejects.toMatchObject({ scope: "ip" });
  });

  it("limits one network to its share of the day across chat and extraction", async () => {
    const { counter } = memoryCounter({ "openai-ip:iphash:2026-11-10": LIMITS.requestsPerIpDay });
    await expect(agentQuota(counter, caller, () => NOW)()).rejects.toMatchObject({ scope: "ip", limit: LIMITS.requestsPerIpDay });
    await expect(extractionQuota(counter, caller, () => NOW)()).rejects.toMatchObject({ scope: "ip", limit: LIMITS.requestsPerIpDay });
    expect(LIMITS.requestsPerIpDay).toBeLessThan(LIMITS.dailyRequests / 2);
  });
});

describe("client IP", () => {
  it("uses the first forwarded address, then x-real-ip", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });

  it("hashes IPs with a secret so stored keys can't be reversed", () => {
    expect(hashIp("1.2.3.4", "secret")).toMatch(/^[a-f0-9]{32}$/);
    expect(hashIp("1.2.3.4", "secret")).not.toBe(hashIp("1.2.3.4", "other"));
    expect(hashIp("1.2.3.4", "secret")).not.toContain("1.2.3.4");
  });
});

describe("session-state read limit (review N5)", () => {
  it(`allows ${LIMITS.stateReadsPerIpHour} reads per IP per hour, then refuses`, async () => {
    const { counter } = memoryCounter({ [`state:ip:iphash:2026-11-10T03`]: LIMITS.stateReadsPerIpHour - 1 });
    await checkStateLimit(counter, caller, NOW);
    await expect(checkStateLimit(counter, { userId: "other", ipHash: "iphash" }, NOW)).rejects.toMatchObject({ scope: "ip", retryAfterSeconds: 40 * 60 });
  });
});
