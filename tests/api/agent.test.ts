import { describe, expect, it, vi } from "vitest";

// Plain fakes instead of vi.fn() (TESTING.md "Known quirks").
let fakeRequireUser: () => Promise<unknown> = async () => ({ user: { id: "u1" }, supabase: {} });
let fakeChatLimit: () => Promise<void> = async () => undefined;
let fakeRunTurn: (message: string) => Promise<unknown> = async (message) => ({ turnId: "t1", events: [], final: `echo: ${message}` });
let fakeOutcome: unknown = { status: "executed", result: { summary: "archived 3", forUI: { kind: "x" } } };
const scheduled: unknown[] = [];

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireUser: () => fakeRequireUser(),
  createAdminSupabase: () => ({}),
}));
vi.mock("@/lib/safety/limits", async (importOriginal) => ({ ...(await importOriginal<object>()), checkChatLimit: () => fakeChatLimit() }));
vi.mock("@/lib/agent/runtime", () => ({
  callerFor: () => ({ userId: "u1", ipHash: "h" }),
  counterFor: () => async () => 1,
  createToolContext: (input: { timezone?: string; background: (task: () => Promise<void>) => void }) => ({ input }),
  createTurnDeps: (ctx: unknown) => ({ ctx }),
  registry: new Map(),
}));
vi.mock("@/lib/agent/loop", () => ({ runTurn: (message: string) => fakeRunTurn(message) }));
vi.mock("@/lib/agent/executor", () => ({ confirmAction: async () => fakeOutcome, rejectAction: async () => fakeOutcome }));
vi.mock("next/server", () => ({ after: (task: unknown) => scheduled.push(task) }));

const { UnauthorizedError } = await import("@/lib/supabase/server");
const { RateLimitError } = await import("@/lib/safety/limits");
const { POST: agent, maxDuration } = await import("@/app/api/agent/route");
const { POST: confirm } = await import("@/app/api/actions/[id]/confirm/route");
const { POST: reject } = await import("@/app/api/actions/[id]/reject/route");

const ID = "123e4567-e89b-42d3-a456-426614174000";
const post = (body: unknown) => new Request("http://localhost/api/agent", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe("POST /api/agent", () => {
  it("runs a turn for a signed-in user and returns its events", async () => {
    const response = await agent(post({ message: "  find jobs ", timezone: "America/Los_Angeles" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, turnId: "t1", events: [], final: "echo: find jobs" });
    expect(maxDuration).toBe(300);
  });

  it("returns 401 without a valid session", async () => {
    fakeRequireUser = async () => {
      throw new UnauthorizedError("Missing session token");
    };
    expect((await agent(post({ message: "hi" }))).status).toBe(401);
    fakeRequireUser = async () => ({ user: { id: "u1" }, supabase: {} });
  });

  it.each([["no body", "not json"], ["an empty message", { message: "  " }], ["a huge message", { message: "x".repeat(2001) }], ["a wrong type", { message: 5 }]])(
    "returns 400 for %s",
    async (_label, body) => {
      expect((await agent(post(body))).status).toBe(400);
    },
  );

  it("returns 429 with Retry-After when the chat limit is reached", async () => {
    fakeChatLimit = async () => {
      throw new RateLimitError("ip", 120);
    };
    const response = await agent(post({ message: "hi" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(await response.json()).toMatchObject({ ok: false, retryAfterSeconds: 120 });
    fakeChatLimit = async () => undefined;
  });

  it("hides unexpected errors behind a generic 500", async () => {
    fakeRunTurn = async () => {
      throw new Error("relation action_log does not exist at db.internal");
    };
    const consoleError = console.error;
    console.error = () => undefined;
    const response = await agent(post({ message: "hi" }));
    console.error = consoleError;
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("db.internal");
  });
});

describe("POST /api/actions/:id/confirm|reject", () => {
  it("returns the executed result", async () => {
    fakeOutcome = { status: "executed", result: { summary: "archived 3", forUI: { kind: "pipeline_change" } } };
    const response = await confirm(new Request("http://localhost", { method: "POST" }), params(ID));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "executed", actionId: ID, summary: "archived 3", ui: { kind: "pipeline_change" } });
  });

  it.each([
    ["not_found", 404],
    ["expired", 410],
    ["already_handled", 409],
    ["failed", 500],
    ["rejected", 200],
  ])("maps %s to HTTP %i", async (status, code) => {
    fakeOutcome = { status, action: null, error: "The action failed." };
    const response = await reject(new Request("http://localhost", { method: "POST" }), params(ID));
    expect(response.status).toBe(code);
    const body = await response.json();
    expect(body.ok).toBe(status === "rejected");
    if (code >= 400) expect(body.error).toEqual(expect.any(String));
  });

  it("returns 404 for an id that isn't a UUID, before touching the database", async () => {
    fakeOutcome = { status: "executed", result: { summary: "should not run" } };
    const response = await confirm(new Request("http://localhost", { method: "POST" }), params("../../etc"));
    expect(response.status).toBe(404);
  });

  it("returns 401 without a session", async () => {
    fakeRequireUser = async () => {
      throw new UnauthorizedError("Invalid or expired session");
    };
    expect((await confirm(new Request("http://localhost", { method: "POST" }), params(ID))).status).toBe(401);
    fakeRequireUser = async () => ({ user: { id: "u1" }, supabase: {} });
  });
});
