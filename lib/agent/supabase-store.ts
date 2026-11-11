import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionRecord, AgentStore, Application, ChatMessage, PostingInfo, ResultSet, StoredFile } from "./store";

const BUCKET = "exports";

type Row = Record<string, unknown>;

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data;
}

function toApplication(row: Row): Application {
  return {
    id: row.id as string,
    postingId: row.posting_id as string,
    stage: row.stage as Application["stage"],
    appliedAt: (row.applied_at as string | null) ?? null,
    nextStepAt: (row.next_step_at as string | null) ?? null,
    notes: (row.notes as string) ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toPosting(row: Row): PostingInfo {
  const raw = (row.raw as { locations?: string[]; employmentType?: string | null } | null) ?? {};
  return {
    id: row.id as string,
    source: row.source as PostingInfo["source"],
    sourceId: row.source_id as string,
    company: row.company as string,
    title: row.title as string,
    location: (row.location as string | null) ?? null,
    locations: Array.isArray(raw.locations) ? raw.locations : row.location ? [row.location as string] : [],
    remote: row.remote as PostingInfo["remote"],
    url: row.url as string,
    postedAt: (row.posted_at as string | null) ?? null,
    employmentType: raw.employmentType ?? null,
  };
}

function toFile(row: Row): StoredFile {
  return {
    id: row.id as string,
    kind: row.kind as StoredFile["kind"],
    filename: row.filename as string,
    storagePath: row.storage_path as string,
    supersedesId: (row.supersedes_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function toResultSet(row: Row): ResultSet {
  return {
    id: row.id as string,
    ref: row.ref as string,
    query: row.query,
    postingIds: (row.posting_ids as string[]) ?? [],
    breakdown: row.breakdown,
    ranked: row.ranked,
    createdAt: row.created_at as string,
  };
}

function toAction(row: Row): ActionRecord {
  return {
    id: row.id as string,
    turnId: row.turn_id as string,
    tool: row.tool as string,
    destructive: row.destructive as boolean,
    args: row.args,
    resolvedArgs: row.resolved_args,
    preview: row.preview,
    status: row.status as ActionRecord["status"],
    resultSummary: (row.result_summary as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

const POSTING_COLUMNS = "id, source, source_id, company, title, location, remote, url, posted_at, raw";
const ACTION_COLUMNS = "id, turn_id, tool, destructive, args, resolved_args, preview, status, result_summary, error, duration_ms, expires_at, created_at";

/**
 * AgentStore for one verified user.
 * - `user` is that user's own client (RLS applies): profiles and applications, which users may
 *   also write directly.
 * - `admin` bypasses RLS: shared postings, counters, and the server-written user tables (refs,
 *   result_sets, files, messages, action_log, DECISIONS 019). Every one of those queries filters
 *   or sets `user_id = userId`, taken from the verified session, never from input.
 */
export function createSupabaseAgentStore(admin: SupabaseClient, user: SupabaseClient, userId: string): AgentStore {
  return {
    userId,

    async getRefsForTargets(kind, targetIds) {
      if (targetIds.length === 0) return new Map();
      const data = check(await admin.from("refs").select("ref, target_id").eq("user_id", userId).eq("kind", kind).in("target_id", targetIds), "refs read");
      return new Map((data ?? []).map((row) => [row.target_id as string, row.ref as string]));
    },

    async getRefs(refs) {
      if (refs.length === 0) return new Map();
      const data = check(await admin.from("refs").select("ref, kind, target_id").eq("user_id", userId).in("ref", refs), "refs read");
      return new Map((data ?? []).map((row) => [row.ref as string, { kind: row.kind, targetId: row.target_id as string }]));
    },

    async insertRef(ref, kind, targetId) {
      const { error } = await admin.from("refs").insert({ user_id: userId, ref, kind, target_id: targetId });
      if (!error) return true;
      if (error.code === "23505") return false; // unique violation: this target already has a ref
      throw new Error(`refs write failed: ${error.message}`);
    },

    async increment(key, ttlSeconds) {
      return check(await admin.rpc("increment_counter", { counter_key: key, ttl_seconds: ttlSeconds }), "counter") as number;
    },

    async getProfile() {
      const data = check(await user.from("profiles").select("name, skills, locations, remote_ok, max_years, filters").eq("user_id", userId).maybeSingle(), "profile read");
      if (!data) return null;
      const filters = (data.filters as { excludeClearanceEligible?: boolean } | null) ?? {};
      return {
        name: data.name,
        skills: data.skills ?? [],
        places: data.locations ?? [],
        remoteOk: data.remote_ok,
        maxYears: data.max_years,
        excludeClearanceEligible: filters.excludeClearanceEligible === true,
      };
    },

    async saveProfile(profile) {
      check(
        await user.from("profiles").upsert(
          {
            user_id: userId,
            name: profile.name,
            skills: profile.skills,
            locations: profile.places,
            remote_ok: profile.remoteOk,
            max_years: profile.maxYears,
            filters: { excludeClearanceEligible: profile.excludeClearanceEligible },
          },
          { onConflict: "user_id" },
        ),
        "profile write",
      );
    },

    async getPostings(ids) {
      if (ids.length === 0) return [];
      const rows: Row[] = [];
      for (let start = 0; start < ids.length; start += 200) {
        rows.push(...(check(await admin.from("postings").select(POSTING_COLUMNS).in("id", ids.slice(start, start + 200)), "postings read") ?? []));
      }
      return rows.map(toPosting);
    },

    async getDescription(id) {
      const data = check(await admin.from("postings").select("description").eq("id", id).maybeSingle(), "posting read");
      return (data?.description as string | null) ?? null;
    },

    async listApplications(filter = {}) {
      if ((filter.ids && filter.ids.length === 0) || (filter.postingIds && filter.postingIds.length === 0)) return [];
      let query = user.from("applications").select("*").eq("user_id", userId);
      if (filter.ids) query = query.in("id", filter.ids);
      if (filter.postingIds) query = query.in("posting_id", filter.postingIds);
      if (filter.stages) query = query.in("stage", filter.stages);
      if (filter.updatedBefore) query = query.lt("updated_at", filter.updatedBefore);
      return (check(await query.limit(1000), "applications read") ?? []).map(toApplication);
    },

    async createApplications(rows) {
      if (rows.length === 0) return [];
      const data = check(
        await user
          .from("applications")
          .upsert(
            rows.map((row) => ({ user_id: userId, posting_id: row.postingId, stage: row.stage, applied_at: row.appliedAt ?? null, next_step_at: row.nextStepAt ?? null })),
            { onConflict: "user_id,posting_id", ignoreDuplicates: true },
          )
          .select("*"),
        "applications write",
      );
      return (data ?? []).map(toApplication);
    },

    async updateApplications(ids, patch) {
      if (ids.length === 0) return 0;
      const row: Row = {};
      if (patch.stage !== undefined) row.stage = patch.stage;
      if (patch.appliedAt !== undefined) row.applied_at = patch.appliedAt;
      if (patch.nextStepAt !== undefined) row.next_step_at = patch.nextStepAt;
      if (patch.notes !== undefined) row.notes = patch.notes;
      const data = check(await user.from("applications").update(row).eq("user_id", userId).in("id", ids).select("id"), "applications update");
      return (data ?? []).length;
    },

    async deleteApplications(ids) {
      if (ids.length === 0) return 0;
      const data = check(await user.from("applications").delete().eq("user_id", userId).in("id", ids).select("id"), "applications delete");
      return (data ?? []).length;
    },

    async createResultSet(row) {
      check(
        await admin.from("result_sets").insert({
          id: row.id,
          user_id: userId,
          ref: row.ref,
          query: row.query,
          posting_ids: row.postingIds,
          source_status: row.sourceStatus,
          breakdown: row.breakdown,
        }),
        "result set write",
      );
    },

    async getResultSet(id) {
      const data = check(await admin.from("result_sets").select("*").eq("user_id", userId).eq("id", id).maybeSingle(), "result set read");
      return data ? toResultSet(data) : null;
    },

    async latestResultSet() {
      const data = check(await admin.from("result_sets").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(), "result set read");
      return data ? toResultSet(data) : null;
    },

    async saveRanked(id, ranked) {
      check(await admin.from("result_sets").update({ ranked }).eq("user_id", userId).eq("id", id), "result set update");
    },

    async createFile(row) {
      const data = check(
        await admin
          .from("files")
          .insert({ user_id: userId, kind: row.kind, filename: row.filename, storage_path: row.storagePath, supersedes_id: row.supersedesId })
          .select("*")
          .single(),
        "file write",
      );
      return toFile(data);
    },

    async getFiles(ids) {
      if (ids.length === 0) return [];
      return (check(await admin.from("files").select("*").eq("user_id", userId).in("id", ids), "files read") ?? []).map(toFile);
    },

    async latestFile(kind) {
      const data = check(await admin.from("files").select("*").eq("user_id", userId).eq("kind", kind).order("created_at", { ascending: false }).limit(1).maybeSingle(), "files read");
      return data ? toFile(data) : null;
    },

    async recentFiles(limit) {
      return (check(await admin.from("files").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit), "files read") ?? []).map(toFile);
    },

    async deleteFiles(ids) {
      if (ids.length === 0) return 0;
      return (check(await admin.from("files").delete().eq("user_id", userId).in("id", ids).select("id"), "files delete") ?? []).length;
    },

    async upload(path, body, contentType) {
      if (!path.startsWith(`${userId}/`)) throw new Error("storage path outside the user's folder");
      const { error } = await admin.storage.from(BUCKET).upload(path, new Blob([body], { type: contentType }), { contentType, upsert: false });
      if (error) throw new Error(`upload failed: ${error.message}`);
    },

    async signedUrl(path, expiresInSeconds) {
      if (!path.startsWith(`${userId}/`)) throw new Error("storage path outside the user's folder");
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds, { download: true });
      if (error || !data) throw new Error(`signed URL failed: ${error?.message ?? "no URL"}`);
      return data.signedUrl;
    },

    async removeObjects(paths) {
      const own = paths.filter((path) => path.startsWith(`${userId}/`));
      if (own.length === 0) return;
      const { error } = await admin.storage.from(BUCKET).remove(own);
      if (error) throw new Error(`storage delete failed: ${error.message}`);
    },

    async insertAction(row) {
      const data = check(
        await admin
          .from("action_log")
          .insert({ user_id: userId, turn_id: row.turnId, tool: row.tool, destructive: row.destructive, args: row.args, status: row.status })
          .select("id")
          .single(),
        "action log write",
      );
      return (data as { id: string }).id;
    },

    async updateAction(id, patch) {
      const row: Row = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.resolvedArgs !== undefined) row.resolved_args = patch.resolvedArgs;
      if (patch.preview !== undefined) row.preview = patch.preview;
      if (patch.resultSummary !== undefined) row.result_summary = patch.resultSummary;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.durationMs !== undefined) row.duration_ms = patch.durationMs;
      if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt;
      check(await admin.from("action_log").update(row).eq("user_id", userId).eq("id", id), "action log update");
    },

    async getAction(id) {
      const data = check(await admin.from("action_log").select(ACTION_COLUMNS).eq("user_id", userId).eq("id", id).maybeSingle(), "action read");
      return data ? toAction(data) : null;
    },

    async claimAction(id, now) {
      // One conditional UPDATE ... WHERE ... RETURNING: only one caller can move it to confirmed.
      const data = check(
        await admin
          .from("action_log")
          .update({ status: "confirmed" })
          .eq("user_id", userId)
          .eq("id", id)
          .eq("status", "awaiting_confirmation")
          .eq("destructive", true)
          .gt("expires_at", now)
          .select(ACTION_COLUMNS)
          .maybeSingle(),
        "action confirm",
      );
      return data ? toAction(data) : null;
    },

    async rejectAction(id) {
      const data = check(
        await admin.from("action_log").update({ status: "rejected" }).eq("user_id", userId).eq("id", id).eq("status", "awaiting_confirmation").select(ACTION_COLUMNS).maybeSingle(),
        "action reject",
      );
      return data ? toAction(data) : null;
    },

    async pendingActions(now) {
      const data = check(
        await admin.from("action_log").select(ACTION_COLUMNS).eq("user_id", userId).eq("status", "awaiting_confirmation").gt("expires_at", now).order("created_at", { ascending: false }).limit(5),
        "pending actions read",
      );
      return (data ?? []).map(toAction);
    },

    async listActions(limit) {
      const data = check(await admin.from("action_log").select(ACTION_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(limit), "action log read");
      return (data ?? []).map(toAction);
    },

    async expireActions(now) {
      const data = check(
        await admin.from("action_log").update({ status: "expired" }).eq("user_id", userId).eq("status", "awaiting_confirmation").lte("expires_at", now).select("id"),
        "action expiry",
      );
      return (data ?? []).length;
    },

    async addMessage(turnId, role, content) {
      check(await admin.from("messages").insert({ user_id: userId, turn_id: turnId, role, content }), "message write");
    },

    async recentMessages(limit) {
      const data = check(await admin.from("messages").select("role, content, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit), "messages read");
      return (data ?? [])
        .map((row): ChatMessage => ({ role: row.role, content: row.content, createdAt: row.created_at }))
        .reverse();
    },
  };
}
