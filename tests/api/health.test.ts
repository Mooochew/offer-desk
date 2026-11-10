import { describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

// Plain fake instead of vi.fn(): in Vitest 5 a vi.fn() that rejects inside a mocked module
// fails the test even when the route handles the error (see TESTING.md, "Known quirks").
let fakeRequireUser: () => Promise<{ user: Partial<User> }> = async () => ({ user: {} });
let calls = 0;

vi.mock("@/lib/supabase/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/server")>("@/lib/supabase/server");
  return {
    ...actual,
    requireUser: () => {
      calls++;
      return fakeRequireUser();
    },
  };
});

const { UnauthorizedError } = await import("@/lib/supabase/server");
const { POST } = await import("@/app/api/health/route");

function callHealth() {
  return POST(new Request("http://localhost/api/health", { method: "POST" }));
}

describe("POST /api/health", () => {
  it("returns the session's user id", async () => {
    fakeRequireUser = async () => ({ user: { id: "abc", is_anonymous: true } });
    const response = await callHealth();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, userId: "abc", isAnonymous: true });
  });

  it("returns 401 for a missing or bad session", async () => {
    calls = 0;
    fakeRequireUser = async () => {
      throw new UnauthorizedError("Missing session token");
    };
    const response = await callHealth();
    expect(calls).toBe(1);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Missing session token" });
  });

  it("returns 500 for unexpected errors", async () => {
    fakeRequireUser = async () => {
      throw new Error("supabase down");
    };
    const response = await callHealth();
    expect(response.status).toBe(500);
  });
});
