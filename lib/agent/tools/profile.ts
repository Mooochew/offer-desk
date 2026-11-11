import { z } from "zod";
import { clip, loadProfile } from "./shared";
import type { NormalTool } from "./types";

const skill = z.string().trim().min(1).max(60);

const input = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    skills: z.array(skill).max(50).optional().describe("Replace the whole skill list."),
    add_skills: z.array(skill).max(20).optional(),
    remove_skills: z.array(skill).max(20).optional(),
    places: z.array(z.string().trim().min(1).max(60)).max(10).optional().describe('Preferred places, e.g. ["socal", "Seattle"]. [] = anywhere.'),
    remote_ok: z.boolean().optional(),
    max_years: z.number().int().min(0).max(20).optional().describe('"hide anything over 1 year" → 1'),
    exclude_clearance_eligible: z.boolean().optional().describe("Also hide jobs that need you to be able to obtain a clearance."),
  })
  .strict()
  .refine((args) => Object.keys(args).length > 0, { message: "give at least one field to change" });

export const updateProfileTool: NormalTool<z.infer<typeof input>> = {
  name: "update_profile",
  description: "Change the user's profile (skills, places, remote, max years of experience, clearance filter). Only change what the user asked for.",
  destructive: false,
  input,
  async run(args, ctx) {
    const current = await loadProfile(ctx.store);
    const lower = (list: string[]) => new Set(list.map((item) => item.toLowerCase()));
    let skills = args.skills ?? current.skills;
    if (args.add_skills) skills = [...skills, ...args.add_skills.filter((item) => !lower(skills).has(item.toLowerCase()))];
    if (args.remove_skills) skills = skills.filter((item) => !lower(args.remove_skills!).has(item.toLowerCase()));

    const next = {
      name: args.name ?? current.name,
      skills: skills.slice(0, 50),
      places: args.places ?? current.places,
      remoteOk: args.remote_ok ?? current.remoteOk,
      maxYears: args.max_years ?? current.maxYears,
      excludeClearanceEligible: args.exclude_clearance_eligible ?? current.excludeClearanceEligible,
    };
    await ctx.store.saveProfile(next);

    const changed = Object.keys(args).join(", ");
    return {
      summary: `profile updated (${changed})`,
      forModel: {
        updated: Object.keys(args),
        profile: {
          skills: next.skills.map((item) => clip(item, 60)),
          places: next.places,
          remote_ok: next.remoteOk,
          max_years: next.maxYears,
          exclude_clearance_eligible: next.excludeClearanceEligible,
        },
        note: "New limits apply the next time triage_results runs.",
      },
      forUI: { kind: "profile", profile: next },
    };
  },
};
