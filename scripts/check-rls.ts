// Verifies Row Level Security after running supabase/migrations/0001_init.sql.
// Creates two anonymous users and checks they are isolated and locked out of shared tables.
// Run: node --env-file=.env.local scripts/check-rls.ts

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

let failures = 0;

function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
}

async function anonymousUser(): Promise<{ client: SupabaseClient; id: string }> {
  const client = createClient(url, publishableKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message}`);
  return { client, id: data.user.id };
}

const alice = await anonymousUser();
const bob = await anonymousUser();
const admin = createClient(url, secretKey, { auth: { persistSession: false } });

// Own rows: insert and read back.
const insert = await alice.client.from("profiles").insert({ user_id: alice.id, name: "rls-test-alice" });
check("user can create their own profile", !insert.error, insert.error?.message);

const ownRead = await alice.client.from("profiles").select("name").eq("user_id", alice.id);
check("user can read their own profile", ownRead.data?.length === 1, ownRead.error?.message);

// Isolation: Bob can't see or change Alice's row.
const bobRead = await bob.client.from("profiles").select("name").eq("user_id", alice.id);
check("other user cannot see it", (bobRead.data?.length ?? 0) === 0, bobRead.error?.message);

const bobUpdate = await bob.client.from("profiles").update({ name: "hacked" }).eq("user_id", alice.id).select();
check("other user cannot update it", (bobUpdate.data?.length ?? 0) === 0, bobUpdate.error?.message);

// Can't create rows for someone else.
const spoof = await bob.client.from("profiles").insert({ user_id: alice.id, name: "spoof" });
check("user cannot insert a row for another user", Boolean(spoof.error), spoof.error?.code);

// Audit log is read-only for users.
const logInsert = await alice.client.from("action_log").insert({
  user_id: alice.id,
  turn_id: crypto.randomUUID(),
  tool: "fake",
});
check("user cannot write to action_log", Boolean(logInsert.error), logInsert.error?.code);

// Shared tables are server-only.
for (const table of ["postings", "extractions", "board_cache", "search_cache", "counters"]) {
  const read = await alice.client.from(table).select("*").limit(1);
  check(`user cannot read ${table}`, Boolean(read.error) || (read.data?.length ?? 0) === 0, read.error?.code);
}

const rpc = await alice.client.rpc("increment_counter", { counter_key: "rls-test", ttl_seconds: 60 });
check("user cannot call increment_counter", Boolean(rpc.error), rpc.error?.code);

// Server (secret key) can use shared tables and the counter.
const first = await admin.rpc("increment_counter", { counter_key: "rls-test", ttl_seconds: 60 });
const second = await admin.rpc("increment_counter", { counter_key: "rls-test", ttl_seconds: 60 });
check("server can increment counters", second.data === (first.data ?? 0) + 1, first.error?.message ?? second.error?.message);

const bucket = await admin.storage.getBucket("exports");
check("exports bucket exists and is private", bucket.data?.public === false, bucket.error?.message);

// Clean up the test users (cascades to their rows) and the test counter.
await admin.from("counters").delete().eq("key", "rls-test");
await admin.auth.admin.deleteUser(alice.id);
await admin.auth.admin.deleteUser(bob.id);

console.log(failures === 0 ? "\nAll RLS checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
