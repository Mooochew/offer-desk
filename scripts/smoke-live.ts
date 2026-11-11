// Smoke test against the deployed app: two anonymous sessions must be accepted and distinct,
// and a request without a session must be rejected. Test users are deleted afterwards.
// Run: npm run check:live   (optionally: LIVE_URL=https://... npm run check:live)

import { createClient } from "@supabase/supabase-js";

const liveUrl = (process.env.LIVE_URL ?? "https://offer-desk-teal.vercel.app").replace(/\/$/, "");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

let failures = 0;
function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
}

const page = await fetch(liveUrl);
check("home page loads", page.ok, `HTTP ${page.status}`);
check("page title is Offer Desk", (await page.text()).includes("<title>Offer Desk</title>"));

const userIds: string[] = [];
for (const label of ["session A", "session B"]) {
  const client = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session) {
    check(`${label} signs in`, false, error?.message);
    continue;
  }
  userIds.push(data.user!.id);
  const response = await fetch(`${liveUrl}/api/health`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  const body = await response.json();
  check(`${label} accepted by live API`, response.ok && body.userId === data.user!.id, `HTTP ${response.status}`);
  if (label === "session A") {
    check("server secrets are configured on the deployment", body.serverEnvOk === true);
    check("CRON_SECRET is set, so the daily warm-up can run", body.cronConfigured === true);
  }
}
check("sessions are distinct", userIds.length === 2 && userIds[0] !== userIds[1]);

const noToken = await fetch(`${liveUrl}/api/health`, { method: "POST" });
check("request without a session is rejected", noToken.status === 401, `HTTP ${noToken.status}`);

// Phase 4 routes exist on the deployment and refuse anonymous callers (no model call is made).
for (const path of ["/api/agent", "/api/state", "/api/demo/profile", "/api/demo/seed", "/api/actions/123e4567-e89b-42d3-a456-426614174000/confirm", "/api/actions/123e4567-e89b-42d3-a456-426614174000/reject", "/api/files/123e4567-e89b-42d3-a456-426614174000/url"]) {
  const response = await fetch(`${liveUrl}${path}`, { method: "POST", body: "{}" });
  check(`${path} rejects a request without a session`, response.status === 401, `HTTP ${response.status}`);
}

// The daily warm-up only runs for Vercel Cron's Bearer secret (Phase 6).
for (const authorization of [undefined, "Bearer wrong-secret"]) {
  const response = await fetch(`${liveUrl}/api/cron/warm`, { headers: authorization ? { authorization } : {} });
  check(`/api/cron/warm rejects ${authorization ? "a wrong secret" : "a request without the secret"}`, response.status === 401, `HTTP ${response.status}`);
}

for (const id of userIds) await admin.auth.admin.deleteUser(id);

console.log(failures === 0 ? "\nLive smoke test passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
