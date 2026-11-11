import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseAgentStore } from "@/lib/agent/supabase-store";

type Op = { method: string; args: unknown[] };
type Chain = { client: "admin" | "user"; table: string; ops: Op[] };
type Reply = { data?: unknown; error?: { message: string; code?: string } | null };

/**
 * Fake supabase-js client: every builder method records itself; awaiting the chain resolves to
 * `respond(chain)`. Storage and rpc calls are recorded the same way.
 */
function fakeClient(name: Chain["client"], chains: Chain[], respond: (chain: Chain) => Reply) {
  const builder = (chain: Chain): unknown => {
    const target: Record<string, unknown> = {
      then: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
        try {
          resolve({ data: null, error: null, ...respond(chain) });
        } catch (error) {
          reject(error);
        }
      },
    };
    return new Proxy(target, {
      get(object, property: string) {
        if (property in object) return object[property];
        return (...args: unknown[]) => {
          chain.ops.push({ method: property, args });
          return builder(chain);
        };
      },
    });
  };
  const start = (table: string) => {
    const chain: Chain = { client: name, table, ops: [] };
    chains.push(chain);
    return chain;
  };
  return {
    from: (table: string) => builder(start(table)),
    rpc: (fn: string, args: unknown) => {
      const chain = start(`rpc:${fn}`);
      chain.ops.push({ method: "rpc", args: [args] });
      return builder(chain);
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (...args: unknown[]) => respond({ client: name, table: `storage:${bucket}`, ops: [{ method: "upload", args }] }),
        createSignedUrl: async (...args: unknown[]) => respond({ client: name, table: `storage:${bucket}`, ops: [{ method: "createSignedUrl", args }] }),
        remove: async (...args: unknown[]) => respond({ client: name, table: `storage:${bucket}`, ops: [{ method: "remove", args }] }),
      }),
    },
  } as unknown as SupabaseClient;
}

const USER = "11111111-1111-4111-8111-111111111111";
const at = "2026-11-10T20:00:00.000Z";

function rowsFor(chain: Chain): Reply {
  const method = (name: string) => chain.ops.some((op) => op.method === name);
  if (chain.table.startsWith("rpc:")) return { data: 7 };
  if (chain.table.startsWith("storage:")) return chain.ops[0].method === "createSignedUrl" ? { data: { signedUrl: "https://signed" } } : { data: {} };
  switch (chain.table) {
    case "refs":
      return { data: [{ ref: "J1", kind: "posting", target_id: "p1" }] };
    case "profiles":
      return { data: { name: "Sam", skills: ["Go"], locations: ["socal"], remote_ok: true, max_years: 1, filters: { excludeClearanceEligible: true } } };
    case "postings":
      return method("maybeSingle")
        ? { data: { description: "Full text" } }
        : { data: [{ id: "p1", source: "lever", source_id: "s1", company: "Acme", title: "Eng", location: "Irvine, CA", remote: "onsite", url: "https://x", posted_at: at, raw: { locations: ["Irvine, CA", "Remote"], employmentType: "Full-time" } }] };
    case "applications":
      return { data: [{ id: "a1", posting_id: "p1", stage: "saved", applied_at: null, next_step_at: null, notes: "", created_at: at, updated_at: at }] };
    case "result_sets":
      return method("maybeSingle") ? { data: { id: "r1", ref: "S1", query: {}, posting_ids: ["p1"], breakdown: {}, ranked: null, created_at: at } } : { data: null };
    case "files": {
      const file = { id: "f1", kind: "csv", filename: "x.csv", storage_path: `${USER}/a/x.csv`, supersedes_id: null, created_at: at };
      return method("single") || method("maybeSingle") ? { data: file } : { data: [file] };
    }
    case "action_log": {
      const action = { id: "act1", turn_id: "t1", tool: "archive_applications", destructive: true, args: {}, resolved_args: {}, preview: { title: "x" }, status: "confirmed", result_summary: null, error: null, duration_ms: null, expires_at: at, created_at: at };
      return method("single") || method("maybeSingle") ? { data: action } : { data: [action] };
    }
    case "messages":
      return { data: [{ role: "assistant", content: "second", created_at: at }, { role: "user", content: "first", created_at: at }] };
  }
  return { data: null };
}

function setup(respond: (chain: Chain) => Reply = rowsFor) {
  const chains: Chain[] = [];
  const store = createSupabaseAgentStore(fakeClient("admin", chains, respond), fakeClient("user", chains, respond), USER);
  return { store, chains };
}

const has = (chain: Chain, method: string, ...args: unknown[]) => chain.ops.some((op) => op.method === method && JSON.stringify(op.args.slice(0, args.length)) === JSON.stringify(args));
const insertedRows = (chain: Chain) => chain.ops.filter((op) => op.method === "insert" || op.method === "upsert").flatMap((op) => [op.args[0]].flat()) as Record<string, unknown>[];

/** Calls every store method once. */
async function exerciseAll(store: ReturnType<typeof setup>["store"]) {
  await store.getRefsForTargets("posting", ["p1"]);
  await store.getRefs(["J1"]);
  await store.insertRef("J2", "posting", "p2");
  await store.increment("ref:x", 10);
  await store.getProfile();
  await store.saveProfile({ name: null, skills: [], places: [], remoteOk: true, maxYears: 2, excludeClearanceEligible: false });
  await store.getPostings(["p1"]);
  await store.getDescription("p1");
  await store.listApplications({ ids: ["a1"], postingIds: ["p1"], stages: ["saved"], updatedBefore: at });
  await store.createApplications([{ postingId: "p1", stage: "saved" }]);
  await store.updateApplications(["a1"], { stage: "applied", appliedAt: at, nextStepAt: null, notes: "n" });
  await store.deleteApplications(["a1"]);
  await store.createResultSet({ id: "r1", ref: "S1", query: {}, postingIds: [], sourceStatus: null, breakdown: null });
  await store.getResultSet("r1");
  await store.latestResultSet();
  await store.saveRanked("r1", {});
  await store.createFile({ kind: "csv", filename: "x.csv", storagePath: `${USER}/a/x.csv`, supersedesId: null });
  await store.getFiles(["f1"]);
  await store.latestFile("csv");
  await store.recentFiles(5);
  await store.deleteFiles(["f1"]);
  await store.insertAction({ turnId: "t1", tool: "x", destructive: false, args: {}, status: "proposed" });
  await store.updateAction("act1", { status: "executed", resolvedArgs: {}, preview: {}, resultSummary: "s", error: null, durationMs: 1, expiresAt: at });
  await store.getAction("act1");
  await store.claimAction("act1", at);
  await store.rejectAction("act1");
  await store.pendingActions(at);
  await store.addMessage("t1", "user", "hi");
  await store.recentMessages(5);
}

describe("createSupabaseAgentStore", () => {
  it("scopes every query on a user-owned table to the verified user (reads filter, writes set user_id)", async () => {
    const { store, chains } = setup();
    await exerciseAll(store);
    const userTables = ["refs", "profiles", "applications", "result_sets", "files", "action_log", "messages"];
    const scoped = chains.filter((chain) => userTables.includes(chain.table));
    expect(scoped.length).toBeGreaterThan(25);
    for (const chain of scoped) {
      const writes = insertedRows(chain);
      const ok = writes.length ? writes.every((row) => row.user_id === USER) : has(chain, "eq", "user_id", USER);
      expect(ok, `${chain.table}: ${JSON.stringify(chain.ops)}`).toBe(true);
    }
  });

  it("uses the user's own client (RLS) for profiles and applications, the admin client for server-written tables", async () => {
    const { store, chains } = setup();
    await exerciseAll(store);
    for (const chain of chains) {
      if (chain.table === "profiles" || chain.table === "applications") expect(chain.client).toBe("user");
      if (["refs", "result_sets", "files", "action_log", "messages", "postings"].includes(chain.table)) expect(chain.client).toBe("admin");
    }
  });

  it("confirms with one conditional update: own, awaiting, destructive, not expired", async () => {
    const { store, chains } = setup();
    expect(await store.claimAction("act1", at)).toMatchObject({ id: "act1", status: "confirmed", destructive: true });
    const claim = chains.at(-1)!;
    expect(claim.table).toBe("action_log");
    expect(has(claim, "update", { status: "confirmed" })).toBe(true);
    for (const [column, value] of [["user_id", USER], ["id", "act1"], ["status", "awaiting_confirmation"], ["destructive", true]] as const) {
      expect(has(claim, "eq", column, value)).toBe(true);
    }
    expect(has(claim, "gt", "expires_at", at)).toBe(true);
  });

  it("returns null when the conditional confirm or reject matched nothing", async () => {
    const { store } = setup((chain) => (chain.table === "action_log" ? { data: null } : rowsFor(chain)));
    expect(await store.claimAction("act1", at)).toBeNull();
    expect(await store.rejectAction("act1")).toBeNull();
    expect(await store.getAction("act1")).toBeNull();
  });

  it("maps rows to app types", async () => {
    const { store } = setup();
    expect(await store.getProfile()).toEqual({ name: "Sam", skills: ["Go"], places: ["socal"], remoteOk: true, maxYears: 1, excludeClearanceEligible: true });
    expect((await store.getPostings(["p1"]))[0]).toMatchObject({ id: "p1", locations: ["Irvine, CA", "Remote"], employmentType: "Full-time", postedAt: at });
    expect(await store.getDescription("p1")).toBe("Full text");
    expect((await store.recentMessages(5)).map((message) => message.content)).toEqual(["first", "second"]);
    expect(await store.getRefs(["J1"])).toEqual(new Map([["J1", { kind: "posting", targetId: "p1" }]]));
    expect(await store.increment("k", 1)).toBe(7);
    expect(await store.signedUrl(`${USER}/a/x.csv`, 60)).toBe("https://signed");
  });

  it("skips queries for empty id lists", async () => {
    const { store, chains } = setup();
    expect(await store.getRefsForTargets("posting", [])).toEqual(new Map());
    expect(await store.getRefs([])).toEqual(new Map());
    expect(await store.getPostings([])).toEqual([]);
    expect(await store.listApplications({ ids: [] })).toEqual([]);
    expect(await store.createApplications([])).toEqual([]);
    expect(await store.updateApplications([], {})).toBe(0);
    expect(await store.deleteApplications([])).toBe(0);
    expect(await store.getFiles([])).toEqual([]);
    expect(await store.deleteFiles([])).toBe(0);
    await store.removeObjects([]);
    expect(chains).toEqual([]);
  });

  it("reports a ref race as false and other insert errors as failures", async () => {
    const race = setup((chain) => (chain.table === "refs" ? { error: { message: "duplicate key", code: "23505" } } : rowsFor(chain)));
    expect(await race.store.insertRef("J1", "posting", "p1")).toBe(false);
    const broken = setup((chain) => (chain.table === "refs" ? { error: { message: "connection reset" } } : rowsFor(chain)));
    await expect(broken.store.insertRef("J1", "posting", "p1")).rejects.toThrow("refs write failed: connection reset");
  });

  it("surfaces database errors with the operation name", async () => {
    const { store } = setup(() => ({ error: { message: "boom" } }));
    await expect(store.listApplications()).rejects.toThrow("applications read failed: boom");
    await expect(store.upload(`${USER}/a/x.csv`, "x", "text/csv")).rejects.toThrow("upload failed: boom");
    await expect(store.signedUrl(`${USER}/a/x.csv`, 60)).rejects.toThrow("signed URL failed: boom");
    await expect(store.removeObjects([`${USER}/a/x.csv`])).rejects.toThrow("storage delete failed: boom");
  });

  it("refuses storage paths outside the user's folder, even with the admin key", async () => {
    const { store, chains } = setup();
    await expect(store.upload("someone-else/x.csv", "x", "text/csv")).rejects.toThrow("outside the user's folder");
    await expect(store.signedUrl("someone-else/x.csv", 60)).rejects.toThrow("outside the user's folder");
    await store.removeObjects(["someone-else/x.csv"]);
    expect(chains).toEqual([]);
  });
});
