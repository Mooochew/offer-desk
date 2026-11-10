import { z } from "zod";

/** What triage needs to know about the user. Stored in `profiles` (Phase 4 maps the row). */
export const profileSchema = z.object({
  name: z.string().max(100).nullable(),
  skills: z.array(z.string().min(1).max(60)).max(50),
  /** Places or regions, e.g. ["socal"]. Empty = anywhere. */
  places: z.array(z.string().min(1).max(60)).max(10),
  remoteOk: z.boolean(),
  /** Hard filter: postings requiring more years than this are dropped. */
  maxYears: z.number().int().min(0).max(20),
});

export type Profile = z.infer<typeof profileSchema>;
