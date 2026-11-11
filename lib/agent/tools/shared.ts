import { z } from "zod";
import type { Profile } from "@/lib/profile/types";
import type { BoardJob } from "@/lib/sources/types";
import type { RequirementFilters } from "@/lib/triage/filter";
import type { Extraction } from "@/lib/triage/schema";
import type { JobScore } from "@/lib/triage/score";
import { ToolError } from "../errors";
import { assignRefs, REF_PATTERN, resolveRefs } from "../refs";
import type { AgentStore, Application, PostingInfo, StoredProfile } from "../store";
import type { ToolContext } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_BULK = 100;

export const DEFAULT_PROFILE: StoredProfile = {
  name: null,
  skills: [],
  places: [],
  remoteOk: true,
  maxYears: 2,
  excludeClearanceEligible: false,
};

/** A ref argument. Case and spaces are forgiven; anything else is rejected before the tool runs. */
export const refArg = z
  .string()
  .max(10)
  .transform((ref) => ref.trim().toUpperCase())
  .refine((ref) => REF_PATTERN.test(ref), { message: "must be a ref like J3, A2, F1 or S1" });

export function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export async function loadProfile(store: AgentStore): Promise<StoredProfile> {
  return (await store.getProfile()) ?? DEFAULT_PROFILE;
}

export function toTriageProfile(stored: StoredProfile): Profile {
  return { name: stored.name, skills: stored.skills, places: stored.places, remoteOk: stored.remoteOk, maxYears: stored.maxYears };
}

export function toFilters(stored: StoredProfile, overrides: { maxYears?: number; excludeClearanceEligible?: boolean } = {}): RequirementFilters {
  return {
    maxYears: overrides.maxYears ?? stored.maxYears,
    excludeActiveClearance: true,
    excludeClearanceEligible: overrides.excludeClearanceEligible ?? stored.excludeClearanceEligible,
  };
}

export function toBoardJob(posting: PostingInfo): BoardJob {
  return {
    postingId: posting.id,
    source: posting.source === "snapshot" ? "greenhouse" : posting.source,
    sourceId: posting.sourceId,
    company: posting.company,
    title: posting.title,
    location: posting.location,
    locations: posting.locations,
    remote: posting.remote,
    url: posting.url,
    postedAt: posting.postedAt,
    employmentType: posting.employmentType,
  };
}

/**
 * What the model may see about a job: ref, company, title, location. Short third-party fields
 * only, clipped; never the description, quotes or skills (DECISIONS 040, second-order injection).
 */
export function jobBrief(ref: string, job: Pick<BoardJob, "company" | "title" | "location">) {
  return { ref, company: clip(job.company, 60), title: clip(job.title, 90), location: clip(job.location, 60) };
}

export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS));
}

/** Triage output stored on the result set (result_sets.ranked) for later tools and the UI. */
export type StoredTriage = {
  triagedAt: string;
  filters: RequirementFilters;
  breakdown: unknown;
  ranked: { postingId: string; ref: string; score: JobScore; why: string; extraction: Extraction }[];
  dropped: { postingId: string; ref: string; reason: string; evidence: string | null; extraction: Extraction }[];
  unread: { postingId: string; ref: string; reason: string }[];
  notChecked: { postingId: string; ref: string | null }[];
};

export function isStoredTriage(value: unknown): value is StoredTriage {
  return typeof value === "object" && value !== null && Array.isArray((value as StoredTriage).ranked);
}

export type PipelineTarget = { application: Application; posting: PostingInfo; ref: string };

/**
 * Resolves A# and J# refs to this user's applications. A J# with no application yet is created
 * (stage "saved") when `createMissing` is set, otherwise rejected.
 */
export async function resolvePipelineTargets(ctx: ToolContext, refs: string[], createMissing: boolean): Promise<PipelineTarget[]> {
  const resolved = await resolveRefs(ctx.store, refs, ["application", "posting"]);
  const appIds = resolved.filter((item) => item.kind === "application").map((item) => item.targetId);
  const postingIds = resolved.filter((item) => item.kind === "posting").map((item) => item.targetId);

  const byId = await ctx.store.listApplications({ ids: appIds });
  const missingApps = appIds.filter((id) => !byId.some((app) => app.id === id));
  if (missingApps.length) throw new ToolError("not_found", "Some of those applications no longer exist. List the pipeline again for current refs.");

  const byPosting = postingIds.length ? await ctx.store.listApplications({ postingIds }) : [];
  const unsaved = postingIds.filter((id) => !byPosting.some((app) => app.postingId === id));
  if (unsaved.length) {
    if (!createMissing) {
      const jobRefs = resolved.filter((item) => unsaved.includes(item.targetId)).map((item) => item.ref);
      throw new ToolError("not_in_pipeline", `${jobRefs.join(", ")} ${jobRefs.length === 1 ? "is" : "are"} not in the pipeline. Save ${jobRefs.length === 1 ? "it" : "them"} first.`);
    }
    byPosting.push(...(await ctx.store.createApplications(unsaved.map((postingId) => ({ postingId, stage: "saved" as const })))));
  }

  const applications = [...byId, ...byPosting];
  const postings = new Map((await ctx.store.getPostings([...new Set(applications.map((app) => app.postingId))])).map((posting) => [posting.id, posting]));
  const refsByApp = await assignRefs(ctx.store, "application", applications.map((app) => app.id));

  // Keep the order the model gave, without duplicates (A3 and the J# of the same job).
  const seen = new Set<string>();
  const ordered: PipelineTarget[] = [];
  for (const item of resolved) {
    const application = item.kind === "application" ? applications.find((app) => app.id === item.targetId) : applications.find((app) => app.postingId === item.targetId);
    if (!application || seen.has(application.id)) continue;
    seen.add(application.id);
    const posting = postings.get(application.postingId);
    if (posting) ordered.push({ application, posting, ref: refsByApp.get(application.id)! });
  }
  return ordered;
}

/** Applications with their postings and A# refs, for list and bulk tools. */
export async function withPostings(store: AgentStore, applications: Application[]): Promise<PipelineTarget[]> {
  if (applications.length === 0) return [];
  const postings = new Map((await store.getPostings([...new Set(applications.map((app) => app.postingId))])).map((posting) => [posting.id, posting]));
  const refs = await assignRefs(store, "application", applications.map((app) => app.id));
  return applications.flatMap((application) => {
    const posting = postings.get(application.postingId);
    return posting ? [{ application, posting, ref: refs.get(application.id)! }] : [];
  });
}
