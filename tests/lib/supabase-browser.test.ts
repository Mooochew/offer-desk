import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Supabase auth. Plain functions with settable behavior (see TESTING.md, "Known quirks").
let currentSession: { access_token: string } | null = null;
let signInCalls = 0;
let signInResult: () => Promise<{ data: { session: { access_token: string } | null }; error: { message: string } | null }>;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: currentSession } }),
      signInAnonymously: () => {
        signInCalls++;
        return signInResult();
      },
    },
  }),
}));

const { getAccessToken, authedFetch } = await import("@/lib/supabase/browser");

beforeEach(() => {
  currentSession = null;
  signInCalls = 0;
  signInResult = async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const session = { access_token: `token-${signInCalls}` };
    currentSession = session;
    return { data: { session }, error: null };
  };
});

describe("getAccessToken", () => {
  it("reuses an existing session without signing in", async () => {
    currentSession = { access_token: "existing" };
    expect(await getAccessToken()).toBe("existing");
    expect(signInCalls).toBe(0);
  });

  it("concurrent first calls create exactly one anonymous user", async () => {
    const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
    expect(signInCalls).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(["token-1"]));
  });

  it("surfaces a sign-in failure and allows a retry afterwards", async () => {
    signInResult = async () => ({ data: { session: null }, error: { message: "anonymous sign-ins disabled" } });
    await expect(getAccessToken()).rejects.toThrow("anonymous sign-ins disabled");

    signInResult = async () => ({ data: { session: { access_token: "retry" } }, error: null });
    expect(await getAccessToken()).toBe("retry");
    expect(signInCalls).toBe(2);
  });
});

describe("authedFetch", () => {
  it("sends the session token as a Bearer header and keeps other headers", async () => {
    currentSession = { access_token: "abc" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await authedFetch("/api/health", { method: "POST", headers: { "X-Test": "1" } });

    const [, init] = fetchSpy.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer abc");
    expect(headers.get("X-Test")).toBe("1");
    fetchSpy.mockRestore();
  });
});
