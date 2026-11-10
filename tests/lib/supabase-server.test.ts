import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock supabase-js so tests never call the network. getUser's result is set per test.
const getUser = vi.fn();
const createClient = vi.fn((url: string, key: string, options: unknown) => ({
  url,
  key,
  options,
  auth: { getUser },
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { requireUser, UnauthorizedError, createAdminSupabase, createUserSupabase } = await import(
  "@/lib/supabase/server"
);

function requestWith(authorization?: string) {
  const headers = authorization ? { authorization } : undefined;
  return new Request("http://localhost/api/test", { method: "POST", headers });
}

beforeEach(() => {
  getUser.mockReset();
  createClient.mockClear();
});

describe("requireUser", () => {
  it("rejects a request with no Authorization header", async () => {
    await expect(requireUser(requestWith())).rejects.toBeInstanceOf(UnauthorizedError);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer Authorization header", async () => {
    await expect(requireUser(requestWith("Basic abc"))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token Supabase does not accept", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    await expect(requireUser(requestWith("Bearer fake"))).rejects.toThrow("Invalid or expired session");
  });

  it("returns the user and a client scoped to their token", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    const { user } = await requireUser(requestWith("Bearer good-token"));

    expect(user.id).toBe("user-1");
    expect(getUser).toHaveBeenCalledWith("good-token");
    const [, key, options] = createClient.mock.calls[0];
    expect(key).toBe("sb_publishable_test");
    expect(options).toMatchObject({ global: { headers: { Authorization: "Bearer good-token" } } });
  });
});

describe("clients", () => {
  it("user client uses the publishable key, never the secret key", () => {
    createUserSupabase("t");
    expect(createClient.mock.calls[0][1]).toBe("sb_publishable_test");
  });

  it("admin client uses the secret key and does not persist sessions", () => {
    createAdminSupabase();
    const [, key, options] = createClient.mock.calls[0];
    expect(key).toBe("sb_secret_test");
    expect(options).toMatchObject({ auth: { persistSession: false } });
  });
});
