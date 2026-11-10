import "server-only";

import { z } from "zod";

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

/** Reads and validates server-only env vars. The `server-only` import keeps this out of browser bundles. */
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
