import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

let browserClient: SupabaseClient | null = null;

/** One Supabase client per browser tab. The session is kept in localStorage. */
export function getBrowserSupabase(): SupabaseClient {
  if (!browserClient) {
    browserClient = createClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
  }
  return browserClient;
}

/** Returns the current access token, signing in anonymously first if there is no session. */
export async function getAccessToken(): Promise<string> {
  const supabase = getBrowserSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;

  const { data: signIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signIn.session) {
    throw new Error(`Could not start a session: ${error?.message ?? "no session returned"}`);
  }
  return signIn.session.access_token;
}

/** fetch() wrapper that attaches the session token so API routes can act as this user. */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
