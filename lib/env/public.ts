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
