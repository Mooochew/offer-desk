import "server-only";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";

const noSessionStorage = { persistSession: false, autoRefreshToken: false };

/**
 * Client that acts as the signed-in user. Row Level Security applies,
 * so it can only read and write that user's rows.
 */
export function createUserSupabase(accessToken: string): SupabaseClient {
  return createClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    auth: noSessionStorage,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Privileged client that bypasses Row Level Security. Use it for shared tables (postings,
 * extractions, caches, counters) and for server-written user rows that users may only read
 * (action_log, refs, files, result_sets, messages). Every user-row write must set user_id from
 * a session verified by requireUser, never from client input.
 */
export function createAdminSupabase(): SupabaseClient {
  return createClient(publicEnv.supabaseUrl, getServerEnv().supabaseSecretKey, {
    auth: noSessionStorage,
  });
}

export class UnauthorizedError extends Error {}

/** Reads the Bearer token from a request and verifies it with Supabase. */
export async function requireUser(request: Request): Promise<{ user: User; supabase: SupabaseClient }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) throw new UnauthorizedError("Missing session token");

  const supabase = createUserSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new UnauthorizedError("Invalid or expired session");

  return { user: data.user, supabase };
}
