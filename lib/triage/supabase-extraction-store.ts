import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CachedExtraction, ExtractionStore } from "./extraction-cache";
import { extractionSchema } from "./schema";

/** Extraction cache in the shared `extractions` table (server-only; RLS denies browser roles). */
export function createSupabaseExtractionStore(admin: SupabaseClient): ExtractionStore {
  return {
    async get(hashes, promptVersion, model) {
      const results = new Map<string, CachedExtraction>();
      if (hashes.length === 0) return results;
      const { data, error } = await admin
        .from("extractions")
        .select("description_hash, status, confidence, extracted, error")
        .eq("prompt_version", promptVersion)
        .eq("model", model)
        .in("description_hash", hashes);
      if (error) throw new Error(`extractions read failed: ${error.message}`);

      for (const row of data ?? []) {
        // Cached rows are re-validated: a row that no longer fits the schema is treated as a miss.
        const parsed = row.status === "ok" ? extractionSchema.safeParse(row.extracted) : null;
        if (parsed && !parsed.success) continue;
        results.set(row.description_hash, {
          status: row.status,
          extraction: parsed?.success ? parsed.data : null,
          error: row.error,
          truncated: row.confidence === "truncated",
        });
      }
      return results;
    },

    async save(hash, promptVersion, model, value) {
      const { error } = await admin.from("extractions").upsert({
        description_hash: hash,
        prompt_version: promptVersion,
        model,
        status: value.status,
        confidence: value.truncated ? "truncated" : "full",
        extracted: value.extraction,
        error: value.error,
      });
      if (error) throw new Error(`extractions write failed: ${error.message}`);
    },
  };
}
