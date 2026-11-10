import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { descriptionHash } from "@/lib/sources/normalize";
import type { Board, NormalizedJob } from "@/lib/sources/types";
import type { BoardStore, CacheEntry } from "./board-cache";
import { jobKey } from "./board-cache";
import { dedupeKey } from "./dedupe";
import type { DescriptionStore, PostingForDescription } from "./descriptions";

const UPSERT_BATCH = 200;

type PostingRow = Record<string, unknown>;

/** Columns written for every job. Descriptions are added only when known (see below). */
function postingRow(board: Board, job: NormalizedJob): PostingRow {
  return {
    source: job.source,
    source_id: job.sourceId,
    company: job.company,
    title: job.title,
    location: job.locations.join("; ") || null,
    remote: job.remote,
    url: job.url,
    posted_at: job.postedAt,
    dedupe_key: dedupeKey(job),
    raw: { ...job.raw, boardSlug: board.slug, locations: job.locations, employmentType: job.employmentType },
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Supabase-backed store. Uses the admin client: postings and board_cache are shared,
 * server-only tables (RLS denies browser roles).
 */
export function createSupabaseStore(admin: SupabaseClient): BoardStore & DescriptionStore {
  return {
    async getEntries(keys) {
      const entries = new Map<string, CacheEntry>();
      if (keys.length === 0) return entries;
      const { data, error } = await admin
        .from("board_cache")
        .select("key, jobs, status, error, fetched_at, expires_at")
        .in("key", keys);
      if (error) throw new Error(`board_cache read failed: ${error.message}`);
      for (const row of data ?? []) {
        entries.set(row.key, {
          jobs: row.jobs ?? [],
          status: row.status,
          error: row.error,
          fetchedAt: row.fetched_at,
          expiresAt: row.expires_at,
        });
      }
      return entries;
    },

    async saveEntry(key, entry) {
      const { error } = await admin.from("board_cache").upsert({
        key,
        jobs: entry.jobs,
        status: entry.status,
        error: entry.error,
        fetched_at: entry.fetchedAt,
        expires_at: entry.expiresAt,
      });
      if (error) throw new Error(`board_cache write failed: ${error.message}`);
    },

    async upsertPostings(board, jobs) {
      const ids = new Map<string, string>();
      // Jobs without a description (Greenhouse list) are upserted without the description
      // columns, so a refresh never wipes a description fetched earlier.
      const withDescription = jobs.filter((job) => job.description);
      const withoutDescription = jobs.filter((job) => !job.description);
      const groups: PostingRow[][] = [
        withDescription.map((job) => ({
          ...postingRow(board, job),
          description: job.description,
          description_hash: descriptionHash(job.description!),
        })),
        withoutDescription.map((job) => postingRow(board, job)),
      ];

      for (const rows of groups) {
        for (let start = 0; start < rows.length; start += UPSERT_BATCH) {
          const { data, error } = await admin
            .from("postings")
            .upsert(rows.slice(start, start + UPSERT_BATCH), { onConflict: "source,source_id" })
            .select("id, source, source_id");
          if (error) throw new Error(`postings upsert failed: ${error.message}`);
          for (const row of data ?? []) ids.set(jobKey({ source: row.source, sourceId: row.source_id }), row.id);
        }
      }
      return ids;
    },

    async insertMissingPostings(board, jobs) {
      const ids = new Map<string, string>();
      for (let start = 0; start < jobs.length; start += UPSERT_BATCH) {
        const batchJobs = jobs.slice(start, start + UPSERT_BATCH);
        const batch: PostingRow[] = batchJobs.map((job) => ({
          ...postingRow(board, job),
          description: job.description,
          description_hash: job.description ? descriptionHash(job.description) : null,
        }));
        // `ignoreDuplicates` makes this INSERT ... ON CONFLICT DO NOTHING: existing rows are untouched.
        const insert = await admin.from("postings").upsert(batch, { onConflict: "source,source_id", ignoreDuplicates: true });
        if (insert.error) throw new Error(`postings insert failed: ${insert.error.message}`);

        const { data, error } = await admin
          .from("postings")
          .select("id, source, source_id")
          .eq("source", board.ats)
          .in("source_id", batchJobs.map((job) => job.sourceId));
        if (error) throw new Error(`postings lookup failed: ${error.message}`);
        for (const row of data ?? []) ids.set(jobKey({ source: row.source, sourceId: row.source_id }), row.id);
      }
      return ids;
    },

    async getPostings(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await admin
        .from("postings")
        .select("id, source, source_id, description, raw")
        .in("id", ids);
      if (error) throw new Error(`postings read failed: ${error.message}`);
      return (data ?? []).map(
        (row): PostingForDescription => ({
          id: row.id,
          source: row.source,
          sourceId: row.source_id,
          description: row.description,
          boardSlug: (row.raw as { boardSlug?: string } | null)?.boardSlug ?? null,
        }),
      );
    },

    async saveDescription(id, description) {
      const { error } = await admin
        .from("postings")
        .update({ description, description_hash: descriptionHash(description) })
        .eq("id", id);
      if (error) throw new Error(`description write failed: ${error.message}`);
    },
  };
}
