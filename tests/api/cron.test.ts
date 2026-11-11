import { afterEach, describe, expect, it, vi } from "vitest";

// Plain fakes instead of vi.fn() (see TESTING.md, "Known quirks").
let warmCalls = 0;
vi.mock("@/lib/cron/warm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cron/warm")>("@/lib/cron/warm");
  return {
    ...actual,
    warmBoardCache: async () => {
      warmCalls++;
      return { boards: 60, refreshed: 12, cached: 48, failed: 0, jobs: 7900 };
    },
  };
});
vi.mock("@/lib/supabase/server", async () => ({ createAdminSupabase: () => ({}) }));

const { GET } = await import("@/app/api/cron/warm/route");

const call = (authorization?: string) => GET(new Request("http://localhost/api/cron/warm", { headers: authorization ? { authorization } : {} }));

describe("GET /api/cron/warm", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    warmCalls = 0;
  });

  it("returns 401 without the secret, with a wrong one, or when none is configured", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(warmCalls).toBe(0);
  });

  it("warms the cache with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const response = await call("Bearer s3cret");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, boards: 60, refreshed: 12 });
    expect(warmCalls).toBe(1);
  });
});
