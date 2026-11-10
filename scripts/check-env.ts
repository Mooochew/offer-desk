// Checks that .env.local keys are present and work, without printing any secret values.
// Run: node --env-file=.env.local scripts/check-env.ts

const required = [
  "OPENAI_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
];

for (const name of required) {
  const value = process.env[name] ?? "";
  console.log(`${value ? "✓" : "✗"} ${name} ${value ? "set" : "MISSING"}`);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
console.log("supabase url looks right:", /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(supabaseUrl));
console.log("publishable key prefix ok:", (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").startsWith("sb_publishable_"));
console.log("secret key prefix ok:", (process.env.SUPABASE_SECRET_KEY ?? "").startsWith("sb_secret_"));

async function check(label: string, url: string, headers: Record<string, string>) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch(() => ({}));
    console.log(`${label}: HTTP ${response.status}`);
    return body;
  } catch (error) {
    console.log(`${label}: ERROR ${(error as Error).message}`);
    return null;
  }
}

export {}; // makes this file a module so top-level await type-checks

const base = supabaseUrl.replace(/\/$/, "");
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

const settings: any = await check("supabase auth settings", `${base}/auth/v1/settings`, { apikey: publishable });
if (settings) console.log("anonymous sign-ins enabled:", settings.external?.anonymous_users ?? settings.anonymous_users ?? "unknown");

const models: any = await check("openai models", "https://api.openai.com/v1/models", {
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
});
if (models?.data) {
  const ids: string[] = models.data.map((m: any) => m.id).filter((id: string) => /^(gpt|o\d)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|instruct|chat-latest|codex)/.test(id));
  console.log("chat-capable models available:", ids.sort().join(", "));
}
