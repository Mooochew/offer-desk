import { z } from "zod";
import { addDays, localDate, zonedTimeToUtc } from "@/lib/files/time";
import { ToolError } from "../errors";
import { computeFunnel } from "../funnel";
import { assignRefs, resolveRefs } from "../refs";
import { STAGES, type Application, type Stage } from "../store";
import { DAY_MS, daysSince, jobBrief, MAX_BULK, refArg, resolvePipelineTargets, withPostings, type PipelineTarget } from "./shared";
import type { DestructiveTool, NormalTool, Preview, ToolContext } from "./types";

const stageEnum = z.enum(STAGES);
/** Archiving goes through archive_applications (confirmation), never through update_stage. */
const movableStage = z.enum(["saved", "applied", "screen", "interview", "offer", "rejected"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

function appBrief(target: PipelineTarget, now: Date) {
  return {
    ...jobBrief(target.ref, target.posting),
    stage: target.application.stage,
    days_since_update: daysSince(target.application.updatedAt, now),
    next_step: target.application.nextStepAt?.slice(0, 16) ?? null,
  };
}

function appForUI(target: PipelineTarget) {
  return { ref: target.ref, application: target.application, posting: target.posting };
}

// ---------------------------------------------------------------------------------------------

const saveInput = z.object({ refs: z.array(refArg).min(1).max(50).describe("Job refs (J#) to save") }).strict();

export const saveToPipelineTool: NormalTool<z.infer<typeof saveInput>> = {
  name: "save_to_pipeline",
  description: "Save jobs (J#) to the user's pipeline as applications (A#) in stage 'saved'. Jobs already saved are skipped.",
  destructive: false,
  input: saveInput,
  async run(args, ctx) {
    const resolved = await resolveRefs(ctx.store, args.refs, ["posting"]);
    const postingIds = resolved.map((item) => item.targetId);
    const known = new Set((await ctx.store.getPostings(postingIds)).map((posting) => posting.id));
    const existing = await ctx.store.listApplications({ postingIds });
    const toCreate = postingIds.filter((id) => known.has(id) && !existing.some((app) => app.postingId === id));
    const created = await ctx.store.createApplications(toCreate.map((postingId) => ({ postingId, stage: "saved" as const })));

    const createdTargets = await withPostings(ctx.store, created);
    const existingTargets = await withPostings(ctx.store, existing);
    const jobRef = (postingId: string) => resolved.find((item) => item.targetId === postingId)!.ref;
    return {
      summary: `saved ${created.length} job(s)${existing.length ? `, ${existing.length} already saved` : ""}`,
      forModel: {
        saved: createdTargets.map((target) => ({ application: target.ref, job: jobRef(target.posting.id), company: target.posting.company, title: target.posting.title })),
        already_in_pipeline: existingTargets.map((target) => ({ application: target.ref, job: jobRef(target.posting.id), stage: target.application.stage })),
      },
      forUI: { kind: "pipeline_change", action: "saved", items: [...createdTargets, ...existingTargets].map(appForUI) },
    };
  },
};

// ---------------------------------------------------------------------------------------------

const stageInput = z
  .object({
    refs: z.array(refArg).min(1).max(MAX_BULK).describe("Application refs (A#) or job refs (J#); jobs not saved yet are added"),
    stage: movableStage,
    days_ago: z.number().int().min(0).max(365).optional().describe('"yesterday" = 1. Omit for today. Code computes the date.'),
    date: isoDate.optional().describe("Only when the user gave an exact date (YYYY-MM-DD, local). Otherwise use days_ago."),
  })
  .strict()
  .refine((args) => !(args.date && args.days_ago !== undefined), { message: "give date or days_ago, not both" });

export const updateStageTool: NormalTool<z.infer<typeof stageInput>> = {
  name: "update_stage",
  description: "Move applications to a stage (saved, applied, screen, interview, offer, rejected). To archive, use archive_applications.",
  destructive: false,
  input: stageInput,
  async run(args, ctx) {
    const targets = await resolvePipelineTargets(ctx, args.refs, true);
    const day = args.date ?? (args.days_ago !== undefined ? addDays(localDate(ctx.now(), ctx.timezone), -args.days_ago) : null);
    const when = day ? zonedTimeToUtc(`${day}T12:00`, ctx.timezone) : ctx.now();
    if (!when) throw new ToolError("bad_date", `${args.date} is not a real date.`);
    if (when.getTime() > ctx.now().getTime() + DAY_MS) throw new ToolError("future_date", "That date is in the future. Use the day it actually happened.");

    const patch: Partial<Application> = { stage: args.stage };
    if (args.stage === "applied") patch.appliedAt = when.toISOString();
    const ids = targets.map((target) => target.application.id);
    const updated = await ctx.store.updateApplications(ids, patch);
    const now = ctx.now().toISOString();
    for (const target of targets) Object.assign(target.application, patch, { updatedAt: now });

    return {
      summary: `${updated} application(s) → ${args.stage}`,
      // The user's local date, not UTC (6 PM in California is already "tomorrow" in UTC).
      forModel: { updated, stage: args.stage, date: localDate(when, ctx.timezone), applications: targets.map((target) => appBrief(target, ctx.now())) },
      forUI: { kind: "pipeline_change", action: "stage", stage: args.stage, items: targets.map(appForUI) },
    };
  },
};

// ---------------------------------------------------------------------------------------------

const noteInput = z.object({ ref: refArg.describe("Application (A#) or job (J#)"), text: z.string().trim().min(1).max(500) }).strict();
const MAX_NOTES = 2000;

export const addNoteTool: NormalTool<z.infer<typeof noteInput>> = {
  name: "add_note",
  description: "Add a dated note to an application. Saves the job first if needed.",
  destructive: false,
  input: noteInput,
  async run(args, ctx) {
    const [target] = await resolvePipelineTargets(ctx, [args.ref], true);
    const line = `[${ctx.now().toISOString().slice(0, 10)}] ${args.text.replace(/\s+/g, " ")}`;
    const notes = target.application.notes ? `${target.application.notes}\n${line}` : line;
    if (notes.length > MAX_NOTES) throw new ToolError("notes_full", `Notes for ${target.ref} would exceed ${MAX_NOTES} characters. Keep it shorter.`);
    await ctx.store.updateApplications([target.application.id], { notes });
    target.application.notes = notes;
    return {
      summary: `note added to ${target.ref}`,
      forModel: { application: target.ref, added: true, note_count: notes.split("\n").length },
      forUI: { kind: "pipeline_change", action: "note", items: [appForUI(target)] },
    };
  },
};

// ---------------------------------------------------------------------------------------------

const listInput = z
  .object({
    stage: stageEnum.optional(),
    untouched_days: z.number().int().min(1).max(365).optional().describe("Only applications not updated for at least this many days"),
  })
  .strict();

const MODEL_LIST = 30;

async function selectApplications(ctx: ToolContext, where: { stage?: Stage; untouched_days?: number }, includeArchived: boolean) {
  const updatedBefore = where.untouched_days ? new Date(ctx.now().getTime() - where.untouched_days * DAY_MS).toISOString() : undefined;
  const stages = where.stage ? [where.stage] : includeArchived ? undefined : STAGES.filter((stage) => stage !== "archived");
  return ctx.store.listApplications({ stages, updatedBefore });
}

export const listPipelineTool: NormalTool<z.infer<typeof listInput>> = {
  name: "list_pipeline",
  description: "List the user's applications (A#), optionally by stage or by how long they've been untouched. Archived ones only when stage is 'archived'.",
  destructive: false,
  input: listInput,
  async run(args, ctx) {
    const targets = await withPostings(ctx.store, await selectApplications(ctx, args, false));
    targets.sort((a, b) => b.application.updatedAt.localeCompare(a.application.updatedAt));
    const counts: Record<string, number> = {};
    for (const target of targets) counts[target.application.stage] = (counts[target.application.stage] ?? 0) + 1;
    return {
      summary: `${targets.length} application(s)`,
      forModel: {
        total: targets.length,
        by_stage: counts,
        applications: targets.slice(0, MODEL_LIST).map((target) => appBrief(target, ctx.now())),
        ...(targets.length > MODEL_LIST ? { more: targets.length - MODEL_LIST } : {}),
      },
      forUI: { kind: "pipeline", filter: args, items: targets.map(appForUI) },
    };
  },
};

// ---------------------------------------------------------------------------------------------

const funnelInput = z.object({ range_days: z.number().int().min(1).max(365).optional().describe('"this month" = 30. Default 30.') }).strict();

export const getFunnelStatsTool: NormalTool<z.infer<typeof funnelInput>> = {
  name: "get_funnel_stats",
  description:
    "The user's job-search funnel for the last N days (applications added in that window and how far they got), plus the current pipeline by stage and by job source. All numbers are computed in code.",
  destructive: false,
  input: funnelInput,
  async run(args, ctx) {
    const range = args.range_days ?? 30;
    const applications = await ctx.store.listApplications({});
    // No refs needed here, so postings are read directly (Phase 4 review S2: refs cost seconds).
    const sources = new Map((await ctx.store.getPostings([...new Set(applications.map((app) => app.postingId))])).map((posting) => [posting.id, posting.source]));
    const stats = computeFunnel(applications, (id) => sources.get(id) ?? "unknown", ctx.now(), range);
    const { funnel } = stats;
    return {
      summary: `last ${range} days: ${funnel.added} added, ${funnel.applied} applied, ${funnel.responded} responses`,
      forModel: { range_days: range, funnel_in_range: funnel, response_rate_percent: stats.responseRate, pipeline_now: stats.pipelineNow, by_source_all_time: stats.bySource },
      forUI: { kind: "funnel", ...stats },
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Destructive: these only propose. The user confirms in the app, then the stored ids are used.

const bulkInput = z
  .object({
    refs: z.array(refArg).min(1).max(MAX_BULK).optional().describe("Application (A#) or job (J#) refs"),
    stage: stageEnum.optional(),
    untouched_days: z.number().int().min(1).max(365).optional().describe('"haven\'t touched in 3 weeks" = 21'),
  })
  .strict()
  .refine((args) => args.refs || args.stage || args.untouched_days, { message: "give refs, or a stage and/or untouched_days selector" });

type BulkArgs = z.infer<typeof bulkInput>;
const resolvedIds = z.object({ application_ids: z.array(z.uuid()).min(1).max(MAX_BULK) }).strict();
type ResolvedIds = z.infer<typeof resolvedIds>;

async function prepareBulk(args: BulkArgs, ctx: ToolContext, verb: string, skipArchived: boolean): Promise<{ resolved: ResolvedIds; preview: Preview }> {
  let targets: PipelineTarget[];
  if (args.refs) {
    targets = await resolvePipelineTargets(ctx, args.refs, false);
    if (args.stage) targets = targets.filter((target) => target.application.stage === args.stage);
    // Every selector given narrows the refs (review N1): none is silently ignored.
    if (args.untouched_days) {
      const cutoff = new Date(ctx.now().getTime() - args.untouched_days * DAY_MS).toISOString();
      targets = targets.filter((target) => target.application.updatedAt < cutoff);
    }
  } else {
    targets = await withPostings(ctx.store, await selectApplications(ctx, args, !skipArchived));
  }
  if (skipArchived) targets = targets.filter((target) => target.application.stage !== "archived");
  if (targets.length === 0) throw new ToolError("nothing_matched", `No applications match, so there is nothing to ${verb}.`);
  if (targets.length > MAX_BULK) throw new ToolError("too_many", `${targets.length} applications match; the limit is ${MAX_BULK} at once. Narrow the selection.`);

  targets.sort((a, b) => a.application.updatedAt.localeCompare(b.application.updatedAt));
  return {
    resolved: { application_ids: targets.map((target) => target.application.id) },
    preview: {
      title: `${verb[0].toUpperCase()}${verb.slice(1)} ${targets.length} application${targets.length === 1 ? "" : "s"}?`,
      count: targets.length,
      items: targets.map((target) => ({
        ref: target.ref,
        label: `${target.posting.title} · ${target.posting.company}`,
        detail: `${target.application.stage} · last touched ${daysSince(target.application.updatedAt, ctx.now())} days ago`,
      })),
    },
  };
}

export const archiveApplicationsTool: DestructiveTool<BulkArgs, ResolvedIds> = {
  name: "archive_applications",
  description:
    "Archive applications by refs or by selector (stage, untouched_days). DESTRUCTIVE: this only proposes the action; the user must confirm it in the app before anything changes.",
  destructive: true,
  input: bulkInput,
  resolved: resolvedIds,
  prepare: (args, ctx) => prepareBulk(args, ctx, "archive", true),
  async execute(resolved, ctx) {
    const count = await ctx.store.updateApplications(resolved.application_ids, { stage: "archived" });
    const refs = await assignRefs(ctx.store, "application", resolved.application_ids);
    return {
      summary: `archived ${count} application(s)`,
      forModel: { archived: count },
      forUI: { kind: "pipeline_change", action: "archived", refs: [...refs.values()] },
    };
  },
};

export const deleteApplicationsTool: DestructiveTool<BulkArgs, ResolvedIds> = {
  name: "delete_applications",
  description:
    "Permanently delete applications (and their notes) by refs or selector. DESTRUCTIVE: this only proposes the action; the user must confirm it. Prefer archive_applications unless the user says delete.",
  destructive: true,
  input: bulkInput,
  resolved: resolvedIds,
  prepare: (args, ctx) => prepareBulk(args, ctx, "delete", false),
  async execute(resolved, ctx) {
    const refs = await ctx.store.getRefsForTargets("application", resolved.application_ids);
    const count = await ctx.store.deleteApplications(resolved.application_ids);
    return {
      summary: `deleted ${count} application(s)`,
      forModel: { deleted: count },
      forUI: { kind: "pipeline_change", action: "deleted", refs: [...refs.values()] },
    };
  },
};
