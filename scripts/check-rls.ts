// Verifies Row Level Security and grants against the real Supabase project.
// Creates two anonymous users (alice, bob) plus one test posting, checks isolation on every
// user table, checks shared tables are server-only, then deletes everything it created.
// Run: npm run check:rls

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

const PERMISSION_DENIED = "42501";
const USER_WRITABLE = ["profiles", "applications"] as const;
const SERVER_WRITTEN = ["refs", "files", "result_sets", "messages", "action_log"] as const;
const SHARED = ["postings", "extractions", "board_cache", "search_cache", "counters"] as const;

let failures = 0;
function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
}

type Actor = { client: SupabaseClient; id: string };

async function anonymousUser(): Promise<Actor> {
  const client = createClient(url, publishableKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message}`);
  return { client, id: data.user.id };
}

/** One valid row per user table, owned by `userId`. */
function sampleRow(table: string, userId: string, postingId: string, n = 1): Record<string, unknown> {
  const turnId = crypto.randomUUID();
  switch (table) {
    case "profiles":
      return { user_id: userId, name: "rls-test" };
    case "applications":
      return { user_id: userId, posting_id: postingId };
    case "refs":
      return { user_id: userId, ref: `J${n}`, kind: n === 1 ? "posting" : "application", target_id: postingId };
    case "files":
      return { user_id: userId, kind: "csv", filename: "t.csv", storage_path: `${userId}/t${n}.csv` };
    case "result_sets":
      return { user_id: userId, ref: `S${n}`, query: {} };
    case "messages":
      return { user_id: userId, turn_id: turnId, role: "user", content: "hi" };
    case "action_log":
      return { user_id: userId, turn_id: turnId, tool: "rls_test" };
    default:
      throw new Error(`no sample row for ${table}`);
  }
}

const createdUsers: string[] = [];
let postingId = "";

try {
  const alice = await anonymousUser();
  const bob = await anonymousUser();
  createdUsers.push(alice.id, bob.id);

  const posting = await admin
    .from("postings")
    .insert({
      source: "snapshot",
      source_id: `rls-test-${crypto.randomUUID()}`,
      company: "RLS Test Co",
      title: "Test Engineer",
      url: "https://example.com",
      dedupe_key: "rls-test",
    })
    .select("id")
    .single();
  check("server can insert into postings", !posting.error, posting.error?.message);
  postingId = posting.data?.id ?? "";

  // Tables users write themselves: own rows only.
  for (const table of USER_WRITABLE) {
    const insert = await alice.client.from(table).insert(sampleRow(table, alice.id, postingId));
    check(`${table}: user can insert own row`, !insert.error, insert.error?.message);

    const own = await alice.client.from(table).select("user_id").eq("user_id", alice.id);
    check(`${table}: user can read own row`, own.data?.length === 1, own.error?.message);

    const peek = await bob.client.from(table).select("user_id").eq("user_id", alice.id);
    check(`${table}: other user cannot read it`, !peek.error && peek.data?.length === 0, peek.error?.message);

    const tamper = await bob.client.from(table).delete().eq("user_id", alice.id).select();
    check(`${table}: other user cannot delete it`, (tamper.data?.length ?? 0) === 0, tamper.error?.message);

    const spoof = await bob.client.from(table).insert(sampleRow(table, alice.id, postingId));
    check(`${table}: cannot insert a row for another user`, spoof.error?.code === PERMISSION_DENIED, spoof.error?.code);
  }

  // Tables only the server writes: users can read their own rows, never write.
  for (const table of SERVER_WRITTEN) {
    const write = await alice.client.from(table).insert(sampleRow(table, alice.id, postingId));
    check(`${table}: user cannot write (migration 0004)`, write.error?.code === PERMISSION_DENIED, write.error?.code ?? "insert succeeded");

    const serverWrite = await admin.from(table).insert(sampleRow(table, alice.id, postingId, 2));
    check(`${table}: server can write`, !serverWrite.error, serverWrite.error?.message);

    const own = await alice.client.from(table).select("user_id").eq("user_id", alice.id);
    check(`${table}: user can read own row`, (own.data?.length ?? 0) >= 1, own.error?.message);

    const peek = await bob.client.from(table).select("user_id").eq("user_id", alice.id);
    check(`${table}: other user cannot read it`, !peek.error && peek.data?.length === 0, peek.error?.message);
  }

  // Storage path must be under the owner's folder (migration 0004).
  const foreignPath = await admin.from("files").insert({
    user_id: alice.id,
    kind: "csv",
    filename: "x.csv",
    storage_path: `${bob.id}/x.csv`,
  });
  check("files: storage_path must start with the owner's id", Boolean(foreignPath.error), foreignPath.error?.code ?? "insert succeeded");

  // Shared tables: browser users get permission denied (not just zero rows); the server has access.
  for (const table of SHARED) {
    const read = await alice.client.from(table).select("*").limit(1);
    check(`${table}: user is denied`, read.error?.code === PERMISSION_DENIED, read.error?.code ?? "no error");

    const serverRead = await admin.from(table).select("*").limit(1);
    check(`${table}: server can read`, !serverRead.error, serverRead.error?.message);
  }

  const rpc = await alice.client.rpc("increment_counter", { counter_key: "rls-test", ttl_seconds: 60 });
  check("increment_counter: user is denied", rpc.error?.code === PERMISSION_DENIED, rpc.error?.code);

  const first = await admin.rpc("increment_counter", { counter_key: "rls-test", ttl_seconds: 60 });
  const second = await admin.rpc("increment_counter", { counter_key: "rls-test", ttl_seconds: 60 });
  check("increment_counter: server increments atomically", second.data === (first.data ?? 0) + 1, first.error?.message ?? second.error?.message);

  const bucket = await admin.storage.getBucket("exports");
  check("exports bucket exists and is private", bucket.data?.public === false, bucket.error?.message);
} catch (error) {
  failures++;
  console.log(`✗ unexpected error: ${(error as Error).message}`);
} finally {
  // Deleting the users cascades to every user-owned row.
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  if (postingId) await admin.from("postings").delete().eq("id", postingId);
  await admin.from("counters").delete().eq("key", "rls-test");
}

console.log(failures === 0 ? "\nAll RLS checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
