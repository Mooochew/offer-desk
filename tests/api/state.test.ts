import { describe, expect, it, vi } from "vitest";

// Plain fakes instead of vi.fn() (TESTING.md "Known quirks").
let fakeRequireUser: () => Promise<unknown> = async () => ({ user: { id: "u1" }, supabase: {} });
let fakeStateLimit: () => Promise<void> = async () => undefined;
let limitCalls = 0;
let loads = 0;

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireUser: () => fakeRequireUser(),
  createAdminSupabase: () => ({}),
}));
vi.mock("@/lib/safety/limits", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkStateLimit: () => {
    limitCalls++;
    return fakeStateLimit();
  },
}));
vi.mock("@/lib/agent/runtime", () => ({ callerFor: () => ({ userId: "u1", ipHash: "h" }), counterFor: () => async () => 1 }));
vi.mock("@/lib/agent/supabase-store", () => ({ createSupabaseAgentStore: () => ({}) }));
vi.mock("@/lib/agent/session-state", () => ({
  loadSessionState: async () => {
    loads++;
    return { profile: null, pipeline: [], files: [], actions: [], messages: [], results: null };
  },
}));

const { UnauthorizedError } = await import("@/lib/supabase/server");
const { RateLimitError } = await import("@/lib/safety/limits");
const { POST } = await import("@/app/api/state/route");
const call = () => POST(new Request("http://localhost/api/state", { method: "POST" }));

describe("POST /api/state", () => {
  it("counts the read against the per-IP limit, then returns the session state", async () => {
    limitCalls = loads = 0;
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, pipeline: [], results: null });
    expect([limitCalls, loads]).toEqual([1, 1]);
  });

  it("returns 401 before counting anything when there is no session", async () => {
    limitCalls = loads = 0;
    fakeRequireUser = async () => {
      throw new UnauthorizedError("Sign in first.");
    };
    expect((await call()).status).toBe(401);
    expect([limitCalls, loads]).toEqual([0, 0]);
    fakeRequireUser = async () => ({ user: { id: "u1" }, supabase: {} });
  });

  it("returns 429 with Retry-After past the limit, without reading the database", async () => {
    loads = 0;
    fakeStateLimit = async () => {
      throw new RateLimitError("ip", 600);
    };
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    expect(await response.json()).toMatchObject({ ok: false, retryAfterSeconds: 600 });
    expect(loads).toBe(0);
    fakeStateLimit = async () => undefined;
  });
});
