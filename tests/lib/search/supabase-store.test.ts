import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseStore } from "@/lib/search/supabase-store";
import type { Board } from "@/lib/sources/types";
import { normalizedJob } from "./fakes";

type Call = { table: string; method: string; args: unknown[] };

/**
 * Minimal fake of the supabase-js query builder: every method records its call and returns the
 * builder; awaiting the builder resolves to the response chosen by `respond`.
 */
function fakeSupabase(respond: (calls: Call[]) => { data?: unknown; error?: { message: string } | null }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const own: Call[] = [];
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "in", "upsert", "update", "eq"]) {
        builder[method] = (...args: unknown[]) => {
          const call = { table, method, args };
          calls.push(call);
          own.push(call);
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => void) => resolve({ error: null, ...respond(own) });
      return builder;
    },
  };
  return { admin: client as unknown as SupabaseClient, calls };
}

const board: Board = { name: "Acme", ats: "greenhouse", slug: "acme", tags: [] };

describe("createSupabaseStore", () => {
  it("upserts jobs with descriptions separately so a refresh never wipes a fetched description", async () => {
    const { admin, calls } = fakeSupabase((own) => {
      const rows = own.find((call) => call.method === "upsert")!.args[0] as { source: string; source_id: string }[];
      return { data: rows.map((row) => ({ id: `id-${row.source_id}`, source: row.source, source_id: row.source_id })) };
    });
    const store = createSupabaseStore(admin);
    const described = normalizedJob({ sourceId: "1", description: "Full text" });
    const listOnly = normalizedJob({ sourceId: "2", description: null });

    const ids = await store.upsertPostings(board, [described, listOnly]);

    const upserts = calls.filter((call) => call.method === "upsert");
    expect(upserts).toHaveLength(2);
    const [withText, withoutText] = upserts.map((call) => (call.args[0] as Record<string, unknown>[])[0]);
    expect(withText).toMatchObject({ source_id: "1", description: "Full text" });
    expect(withText.description_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(withoutText).not.toHaveProperty("description");
    expect(withoutText).not.toHaveProperty("description_hash");
    expect(withoutText.raw).toMatchObject({ boardSlug: "acme" });
    expect(upserts[0].args[1]).toEqual({ onConflict: "source,source_id" });
    expect(ids.get("greenhouse:1")).toBe("id-1");
    expect(ids.get("greenhouse:2")).toBe("id-2");
  });

  it("splits large upserts into batches of 200", async () => {
    const { admin, calls } = fakeSupabase(() => ({ data: [] }));
    const jobs = Array.from({ length: 450 }, (_, i) => normalizedJob({ sourceId: String(i) }));
    await createSupabaseStore(admin).upsertPostings(board, jobs);
    const sizes = calls.filter((call) => call.method === "upsert").map((call) => (call.args[0] as unknown[]).length);
    expect(sizes).toEqual([200, 200, 50]);
  });

  it("surfaces database errors instead of silently returning nothing", async () => {
    const { admin } = fakeSupabase(() => ({ error: { message: "permission denied" } }));
    const store = createSupabaseStore(admin);
    await expect(store.upsertPostings(board, [normalizedJob()])).rejects.toThrow("permission denied");
    await expect(store.getEntries(["greenhouse:acme"])).rejects.toThrow("permission denied");
    await expect(store.saveEntry("k", { jobs: [], status: "ok", error: null, fetchedAt: "", expiresAt: "" })).rejects.toThrow(
      "permission denied",
    );
    await expect(store.getPostings(["p1"])).rejects.toThrow("permission denied");
    await expect(store.saveDescription("p1", "text")).rejects.toThrow("permission denied");
  });

  it("maps board_cache rows to cache entries and skips the query for no keys", async () => {
    const { admin, calls } = fakeSupabase(() => ({
      data: [{ key: "greenhouse:acme", jobs: null, status: "ok", error: null, fetched_at: "f", expires_at: "e" }],
    }));
    const store = createSupabaseStore(admin);
    expect((await store.getEntries([])).size).toBe(0);
    expect(calls).toHaveLength(0);

    const entries = await store.getEntries(["greenhouse:acme"]);
    expect(entries.get("greenhouse:acme")).toEqual({ jobs: [], status: "ok", error: null, fetchedAt: "f", expiresAt: "e" });
  });

  it("reads postings for descriptions, including the board slug from raw", async () => {
    const { admin } = fakeSupabase(() => ({
      data: [
        { id: "p1", source: "greenhouse", source_id: "9", description: null, raw: { boardSlug: "acme" } },
        { id: "p2", source: "lever", source_id: "x", description: "d", raw: null },
      ],
    }));
    const store = createSupabaseStore(admin);
    expect(await store.getPostings([])).toEqual([]);
    expect(await store.getPostings(["p1", "p2"])).toEqual([
      { id: "p1", source: "greenhouse", sourceId: "9", description: null, boardSlug: "acme" },
      { id: "p2", source: "lever", sourceId: "x", description: "d", boardSlug: null },
    ]);
  });

  it("saves a description together with its hash", async () => {
    const { admin, calls } = fakeSupabase(() => ({}));
    await createSupabaseStore(admin).saveDescription("p1", "Some text");
    const update = calls.find((call) => call.method === "update")!.args[0] as Record<string, string>;
    expect(update.description).toBe("Some text");
    expect(update.description_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls.find((call) => call.method === "eq")!.args).toEqual(["id", "p1"]);
  });
});
