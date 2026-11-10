import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseExtractionStore } from "@/lib/triage/supabase-extraction-store";
import { extraction } from "./fakes";

type Call = { method: string; args: unknown[] };

/** Chainable fake of the supabase-js query builder (see tests/lib/search/supabase-store.test.ts). */
function fakeSupabase(response: { data?: unknown; error?: { message: string } | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "upsert"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve({ error: null, ...response });
  const admin = { from: () => builder } as unknown as SupabaseClient;
  return { admin, calls };
}

describe("createSupabaseExtractionStore", () => {
  it("reads by prompt version, model and hashes; re-validates cached rows", async () => {
    const { admin, calls } = fakeSupabase({
      data: [
        { description_hash: "h1", status: "ok", confidence: "full", extracted: extraction(), error: null },
        { description_hash: "h2", status: "failed", confidence: "truncated", extracted: null, error: "bad json" },
        { description_hash: "h3", status: "ok", confidence: "full", extracted: { degree: "associate" }, error: null },
      ],
    });
    const rows = await createSupabaseExtractionStore(admin).get(["h1", "h2", "h3"], "extract-v2/check-2", "m");

    expect(calls.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
      ["prompt_version", "extract-v2/check-2"],
      ["model", "m"],
    ]);
    expect(rows.get("h1")).toEqual({ status: "ok", extraction: extraction(), error: null, truncated: false });
    expect(rows.get("h2")).toEqual({ status: "failed", extraction: null, error: "bad json", truncated: true });
    // A cached row that no longer fits the schema is a miss, not trusted data.
    expect(rows.has("h3")).toBe(false);
  });

  it("skips the query for no hashes", async () => {
    const { admin, calls } = fakeSupabase({ data: [] });
    expect((await createSupabaseExtractionStore(admin).get([], "v", "m")).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("saves with confidence derived from truncation", async () => {
    const { admin, calls } = fakeSupabase({});
    await createSupabaseExtractionStore(admin).save("h", "v", "m", { status: "ok", extraction: extraction(), error: null, truncated: true });
    expect(calls[0].args[0]).toMatchObject({ description_hash: "h", prompt_version: "v", model: "m", status: "ok", confidence: "truncated" });
  });

  it("surfaces database errors", async () => {
    const { admin } = fakeSupabase({ error: { message: "denied" } });
    const store = createSupabaseExtractionStore(admin);
    await expect(store.get(["h"], "v", "m")).rejects.toThrow("denied");
    await expect(store.save("h", "v", "m", { status: "failed", extraction: null, error: "x", truncated: false })).rejects.toThrow("denied");
  });
});
