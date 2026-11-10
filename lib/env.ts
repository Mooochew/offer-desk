import { z } from "zod";

// Public values are inlined into the browser bundle, so they must be read with literal
// `process.env.NEXT_PUBLIC_*` access (Next.js replaces these at build time).
const publicSchema = z.object({
  supabaseUrl: z.url(),
  supabasePublishableKey: z.string().startsWith("sb_publishable_"),
});

export const publicEnv = publicSchema.parse({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

const serverSchema = z.object({
  openaiApiKey: z.string().min(1),
  openaiModel: z.string().min(1).default("gpt-6-luna"),
  openaiExtractModel: z.string().min(1).default("gpt-6-luna"),
  supabaseSecretKey: z.string().startsWith("sb_secret_"),
  adzunaAppId: z.string().optional(),
  adzunaAppKey: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cachedServerEnv: ServerEnv | null = null;

/** Reads and validates server-only env vars. Call only from server code. */
export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  cachedServerEnv = serverSchema.parse({
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL || undefined,
    openaiExtractModel: process.env.OPENAI_EXTRACT_MODEL || undefined,
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
    adzunaAppId: process.env.ADZUNA_APP_ID || undefined,
    adzunaAppKey: process.env.ADZUNA_APP_KEY || undefined,
  });
  return cachedServerEnv;
}
