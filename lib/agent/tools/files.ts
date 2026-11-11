import { z } from "zod";
import { buildChecklist, type ChecklistItem } from "@/lib/files/checklist";
import { toCsv } from "@/lib/files/csv";
import { buildInvite } from "@/lib/files/ics";
import { formatLocal, localDate, zonedTimeToUtc } from "@/lib/files/time";
import { ToolError } from "../errors";
import { assignRefs, resolveRefs } from "../refs";
import { STAGES, type FileKind, type PostingInfo, type StoredFile } from "../store";
import { DAY_MS, isStoredTriage, refArg, resolvePipelineTargets, withPostings, type PipelineTarget } from "./shared";
import type { DestructiveTool, NormalTool, Preview, ToolContext } from "./types";

/** Signed download links last an hour; the UI can ask for a fresh one later. */
export const SIGNED_URL_SECONDS = 60 * 60;

const CONTENT_TYPES: Record<FileKind, string> = {
  csv: "text/csv; charset=utf-8",
  checklist: "text/markdown; charset=utf-8",
  ics: "text/calendar; charset=utf-8",
};

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "file";
}

/**
 * Uploads a generated file under the user's own folder (exports/<user_id>/..., enforced by a DB
 * check too), records it, gives it an F# ref and a short-lived signed link. Files are never
 * overwritten: a new version gets a new path and points at the one it supersedes.
 */
async function saveFile(ctx: ToolContext, kind: FileKind, filename: string, body: string, supersedesId: string | null = null) {
  const storagePath = `${ctx.store.userId}/${crypto.randomUUID()}/${filename}`;
  await ctx.store.upload(storagePath, body, CONTENT_TYPES[kind]);
  const file = await ctx.store.createFile({ kind, filename, storagePath, supersedesId });
  const ref = (await assignRefs(ctx.store, "file", [file.id])).get(file.id)!;
  const url = await ctx.store.signedUrl(storagePath, SIGNED_URL_SECONDS);
  return { file, ref, url };
}

function fileForUI(ref: string, file: StoredFile, url: string, extra: Record<string, unknown> = {}) {
  return { kind: "file", ref, fileKind: file.kind, filename: file.filename, url, createdAt: file.createdAt, ...extra };
}

// ---------------------------------------------------------------------------------------------

const csvInput = z
  .object({
    refs: z.array(refArg).min(1).max(200).optional().describe("Application (A#) or job (J#) refs. Omit to export the pipeline."),
    stage: z.enum(STAGES).optional(),
    include_archived: z.boolean().optional(),
  })
  .strict();

export const exportCsvTool: NormalTool<z.infer<typeof csvInput>> = {
  name: "export_csv",
  description: "Export jobs or applications to a CSV file (F#) with a download link. With no refs, exports the pipeline (optionally one stage).",
  destructive: false,
  input: csvInput,
  async run(args, ctx) {
    type Row = { posting: PostingInfo; target: PipelineTarget | null; ref: string };
    let rows: Row[];
    if (args.refs) {
      const resolved = await resolveRefs(ctx.store, args.refs, ["application", "posting"]);
      const jobRefs = resolved.filter((item) => item.kind === "posting");
      const apps = await resolvePipelineTargets(ctx, resolved.filter((item) => item.kind === "application").map((item) => item.ref), false);
      const saved = jobRefs.length ? await withPostings(ctx.store, await ctx.store.listApplications({ postingIds: jobRefs.map((item) => item.targetId) })) : [];
      const postings = new Map((await ctx.store.getPostings(jobRefs.map((item) => item.targetId))).map((posting) => [posting.id, posting]));
      rows = [
        ...apps.map((target) => ({ posting: target.posting, target, ref: target.ref })),
        ...jobRefs.flatMap((item) => {
          const posting = postings.get(item.targetId);
          if (!posting || apps.some((target) => target.posting.id === posting.id)) return [];
          return [{ posting, target: saved.find((target) => target.posting.id === posting.id) ?? null, ref: item.ref }];
        }),
      ];
    } else {
      const stages = args.stage ? [args.stage] : args.include_archived ? undefined : STAGES.filter((stage) => stage !== "archived");
      const targets = await withPostings(ctx.store, await ctx.store.listApplications({ stages }));
      targets.sort((a, b) => b.application.updatedAt.localeCompare(a.application.updatedAt));
      rows = targets.map((target) => ({ posting: target.posting, target, ref: target.ref }));
    }
    if (rows.length === 0) throw new ToolError("nothing_to_export", "There is nothing to export yet.");

    const csv = toCsv(
      ["ref", "company", "title", "location", "stage", "applied_at", "next_step_at", "last_updated", "source", "url", "notes"],
      rows.map(({ posting, target, ref }) => [
        ref,
        posting.company,
        posting.title,
        posting.location,
        target?.application.stage ?? "",
        target?.application.appliedAt?.slice(0, 10) ?? "",
        target?.application.nextStepAt ?? "",
        target?.application.updatedAt.slice(0, 10) ?? "",
        posting.source,
        posting.url,
        target?.application.notes ?? "",
      ]),
    );
    const filename = `offer-desk-${args.refs ? "jobs" : args.stage ?? "pipeline"}-${localDate(ctx.now(), ctx.timezone)}.csv`;
    const { file, ref, url } = await saveFile(ctx, "csv", filename, csv);
    return {
      summary: `${ref}: ${filename} (${rows.length} rows)`,
      forModel: { file: ref, filename, rows: rows.length },
      forUI: fileForUI(ref, file, url, { rows: rows.length }),
    };
  },
};

// ---------------------------------------------------------------------------------------------

const checklistInput = z.object({ refs: z.array(refArg).min(1).max(25).describe("Job (J#) or application (A#) refs, in the order to apply") }).strict();

export const generateApplyChecklistTool: NormalTool<z.infer<typeof checklistInput>> = {
  name: "generate_apply_checklist",
  description: "Create a Markdown apply checklist (F#) for jobs: title, company, score, why it matched, apply link, and steps. Regenerating makes a new version; old versions are kept.",
  destructive: false,
  input: checklistInput,
  async run(args, ctx) {
    const resolved = await resolveRefs(ctx.store, args.refs, ["application", "posting"]);
    const apps = await resolvePipelineTargets(ctx, resolved.filter((item) => item.kind === "application").map((item) => item.ref), false);
    const jobIds = resolved.filter((item) => item.kind === "posting").map((item) => item.targetId);
    const postings = new Map((await ctx.store.getPostings([...jobIds, ...apps.map((target) => target.posting.id)])).map((posting) => [posting.id, posting]));
    const stages = new Map((await ctx.store.listApplications({ postingIds: [...postings.keys()] })).map((app) => [app.postingId, app.stage]));

    const latest = await ctx.store.latestResultSet();
    const triage = latest && isStoredTriage(latest.ranked) ? latest.ranked : null;

    const items: ChecklistItem[] = resolved.flatMap((item) => {
      const postingId = item.kind === "posting" ? item.targetId : apps.find((target) => target.application.id === item.targetId)?.posting.id;
      const posting = postingId ? postings.get(postingId) : undefined;
      if (!posting) return [];
      const ranked = triage?.ranked.find((entry) => entry.postingId === posting.id);
      return [{ ref: item.ref, title: posting.title, company: posting.company, location: posting.location, url: posting.url, score: ranked?.score.total ?? null, why: ranked?.why ?? null, stage: stages.get(posting.id) ?? null }];
    });
    if (items.length === 0) throw new ToolError("not_found", "None of those jobs exist anymore.");

    const previous = await ctx.store.latestFile("checklist");
    const version = await ctx.store.increment(`file-version:${ctx.store.userId}:checklist`, 10 * 365 * 24 * 60 * 60);
    const today = localDate(ctx.now(), ctx.timezone);
    const markdown = buildChecklist(items, today, version);
    const filename = `apply-checklist-v${version}-${today}.md`;
    const { file, ref, url } = await saveFile(ctx, "checklist", filename, markdown, previous?.id ?? null);
    return {
      summary: `${ref}: ${filename} (${items.length} jobs)`,
      forModel: { file: ref, filename, jobs: items.length, version, ...(previous ? { replaces_previous_version: true } : {}) },
      forUI: fileForUI(ref, file, url, { jobs: items.length, version }),
    };
  },
};

// ---------------------------------------------------------------------------------------------

const inviteInput = z
  .object({
    ref: refArg.describe("Application (A#) or job (J#) the interview is for"),
    start_local: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "use YYYY-MM-DDTHH:MM in the user's local time")
      .describe('Local start time, e.g. "2026-11-12T14:00" for Thursday at 2 PM'),
    duration_min: z.number().int().min(15).max(480).optional().describe("Default 60"),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const createInterviewInviteTool: NormalTool<z.infer<typeof inviteInput>> = {
  name: "create_interview_invite",
  description: "Create a calendar invite (.ics, F#) for an interview in the user's timezone, and move the application to 'interview' with that date as the next step.",
  destructive: false,
  input: inviteInput,
  async run(args, ctx) {
    const start = zonedTimeToUtc(args.start_local, ctx.timezone);
    if (!start) throw new ToolError("bad_time", `${args.start_local} is not a real date and time.`);
    if (start.getTime() < ctx.now().getTime() - DAY_MS) throw new ToolError("in_past", "That time is in the past. Check the date (today is in the state block).");

    const [target] = await resolvePipelineTargets(ctx, [args.ref], true);
    const { posting } = target;
    const duration = args.duration_min ?? 60;
    const title = args.title ?? `Interview: ${posting.title} at ${posting.company}`;
    const ics = buildInvite({
      uid: `${crypto.randomUUID()}@offer-desk`,
      title,
      start,
      durationMinutes: duration,
      description: `Interview for ${posting.title} at ${posting.company}.\nPosting: ${posting.url}`,
      url: posting.url,
      createdAt: ctx.now(),
    });
    await ctx.store.updateApplications([target.application.id], { stage: "interview", nextStepAt: start.toISOString() });

    const filename = `interview-${slug(posting.company)}-${args.start_local.slice(0, 10)}.ics`;
    const { file, ref, url } = await saveFile(ctx, "ics", filename, ics);
    const when = formatLocal(start, ctx.timezone);
    return {
      summary: `${ref}: ${filename} (${when}); ${target.ref} → interview`,
      forModel: { file: ref, filename, application: target.ref, stage: "interview", starts: when, duration_min: duration },
      forUI: fileForUI(ref, file, url, { application: target.ref, startsAt: start.toISOString(), startsLocal: when, durationMinutes: duration }),
    };
  },
};

// ---------------------------------------------------------------------------------------------

const deleteFilesInput = z.object({ refs: z.array(refArg).min(1).max(50).describe("File refs (F#)") }).strict();
const resolvedFiles = z.object({ file_ids: z.array(z.uuid()).min(1).max(50) }).strict();

export const deleteFilesTool: DestructiveTool<z.infer<typeof deleteFilesInput>, z.infer<typeof resolvedFiles>> = {
  name: "delete_files",
  description: "Delete generated files (F#). DESTRUCTIVE: this only proposes the action; the user must confirm it in the app.",
  destructive: true,
  input: deleteFilesInput,
  resolved: resolvedFiles,
  async prepare(args, ctx) {
    const resolved = await resolveRefs(ctx.store, args.refs, ["file"]);
    const files = await ctx.store.getFiles(resolved.map((item) => item.targetId));
    if (files.length === 0) throw new ToolError("nothing_matched", "Those files no longer exist.");
    const refOf = (id: string) => resolved.find((item) => item.targetId === id)!.ref;
    const preview: Preview = {
      title: `Delete ${files.length} file${files.length === 1 ? "" : "s"}?`,
      count: files.length,
      items: files.map((file) => ({ ref: refOf(file.id), label: file.filename, detail: `${file.kind} · created ${file.createdAt.slice(0, 10)}` })),
    };
    return { resolved: { file_ids: files.map((file) => file.id) }, preview };
  },
  async execute(resolved, ctx) {
    const files = await ctx.store.getFiles(resolved.file_ids);
    const refs = await ctx.store.getRefsForTargets("file", files.map((file) => file.id));
    await ctx.store.removeObjects(files.map((file) => file.storagePath));
    const count = await ctx.store.deleteFiles(files.map((file) => file.id));
    return { summary: `deleted ${count} file(s)`, forModel: { deleted: count }, forUI: { kind: "files_deleted", refs: [...refs.values()] } };
  },
};
