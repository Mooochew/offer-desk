import { z } from "zod";
import type { SearchCriteria } from "@/lib/search/filter";
import { rolesInQuery } from "@/lib/search/title";
import { tagsFor } from "@/lib/sources/boards";
import { ToolError } from "../errors";
import { assignRefs, resolveRefs } from "../refs";
import type { ResultSet } from "../store";
import {
  clip,
  isStoredTriage,
  jobBrief,
  loadProfile,
  refArg,
  toBoardJob,
  toFilters,
  toTriageProfile,
  type StoredTriage,
} from "./shared";
import type { NormalTool, ToolContext } from "./types";

/** Jobs from a search that get refs (and are shown in the UI list). */
const SEARCH_REFS = 50;
/** Jobs the model sees per result: enough for "the top 5", small enough to keep tokens flat. */
const MODEL_TOP = 10;
/** The same search within this window reuses its result set (the model sometimes re-searches). */
const REUSE_MS = 10 * 60 * 1000;

/**
 * What actually decides a search's results, computed in code: the role words and board tags read
 * from the query, plus places, remote, age and internships. Two queries worded differently
 * ("entry-level backend roles" / "backend jobs for new grads") give the same results when these match.
 */
function searchKey(criteria: SearchCriteria): string {
  const places = [...(criteria.places ?? [])].map((place) => place.toLowerCase()).sort();
  return JSON.stringify({
    roles: [...rolesInQuery(criteria.query)].sort(),
    tags: [...tagsFor(criteria.query, places)].sort(),
    places,
    remoteOk: criteria.remoteOk ?? false,
    postedWithinDays: criteria.postedWithinDays ?? null,
    includeInternships: criteria.includeInternships ?? false,
  });
}

const searchInput = z
  .object({
    query: z.string().min(2).max(200).describe('What the user is looking for, e.g. "entry-level backend and full-stack roles"'),
    places: z.array(z.string().min(1).max(60)).max(10).optional().describe('Places or regions, e.g. ["socal"], ["Seattle"]. Omit to use the profile.'),
    remote_ok: z.boolean().optional().describe("Include US-remote jobs. Omit to use the profile."),
    posted_within_days: z.number().int().min(1).max(90).optional().describe('"this week" = 7, "this month" = 30'),
    include_internships: z.boolean().optional(),
  })
  .strict();

export const searchJobsTool: NormalTool<z.infer<typeof searchInput>> = {
  name: "search_jobs",
  description:
    "Search company job boards (Greenhouse, Lever, Ashby). Code filters titles, seniority, dates and location and removes duplicates. Returns a result set ref (S#) and the newest matches as job refs (J#). Requirements are NOT checked yet: call triage_results on the set next.",
  destructive: false,
  input: searchInput,
  async run(args, ctx) {
    const profile = await loadProfile(ctx.store);
    const criteria = {
      query: args.query,
      places: args.places ?? profile.places,
      remoteOk: args.remote_ok ?? profile.remoteOk,
      postedWithinDays: args.posted_within_days,
      includeInternships: args.include_internships,
    };
    // Seen live: before "save the top 5" the model sometimes repeats the search it just ran, which
    // made a new, untriaged set the "latest" one. An identical search a few minutes later reuses it.
    const latest = await ctx.store.latestResultSet();
    if (latest && searchKey(latest.query as SearchCriteria) === searchKey(criteria) && ctx.now().getTime() - Date.parse(latest.createdAt) < REUSE_MS) {
      const triage = isStoredTriage(latest.ranked) ? latest.ranked : null;
      return {
        summary: `same search as ${latest.ref} (reused)`,
        forModel: {
          set: latest.ref,
          reused: true,
          matches: latest.postingIds.length,
          note: triage
            ? `This exact search ran minutes ago and ${latest.ref} is already triaged. Use its ranked refs (in the state block or the earlier triage_results); don't triage again.`
            : `This exact search ran minutes ago. Use ${latest.ref}; call triage_results on it if needed.`,
        },
      };
    }
    const result = await ctx.services.search(criteria, ctx.deadline);

    const setId = crypto.randomUUID();
    const setRef = (await assignRefs(ctx.store, "result_set", [setId])).get(setId)!;
    await ctx.store.createResultSet({
      id: setId,
      ref: setRef,
      query: criteria,
      postingIds: result.jobs.map((job) => job.postingId),
      sourceStatus: { sources: result.sources, usedSnapshot: result.usedSnapshot, failures: result.failures.length },
      breakdown: result.breakdown,
    });
    const shown = result.jobs.slice(0, SEARCH_REFS);
    const refs = await assignRefs(ctx.store, "posting", shown.map((job) => job.postingId));

    return {
      summary: `${result.breakdown.considered} jobs considered → ${result.breakdown.remaining} matches (${setRef})${result.usedSnapshot ? ", from the saved snapshot" : ""}`,
      forModel: {
        set: setRef,
        matches: result.breakdown.remaining,
        funnel: result.breakdown,
        sources: result.sources.map((source) => ({ source: source.source, boards: source.boards, failed: source.failed + source.skipped })),
        used_snapshot: result.usedSnapshot,
        newest: shown.slice(0, MODEL_TOP).map((job) => jobBrief(refs.get(job.postingId)!, job)),
        next_step: result.breakdown.remaining > 0 ? `Call triage_results with set_ref ${setRef} to check requirements and rank.` : "No matches; suggest widening the search.",
      },
      forUI: {
        kind: "search",
        set: setRef,
        breakdown: result.breakdown,
        sources: result.sources,
        usedSnapshot: result.usedSnapshot,
        jobs: shown.map((job) => ({ ref: refs.get(job.postingId)!, ...job })),
        total: result.jobs.length,
      },
    };
  },
};

async function resolveSet(ctx: ToolContext, setRef: string | undefined): Promise<ResultSet> {
  if (setRef) {
    const [resolved] = await resolveRefs(ctx.store, [setRef], ["result_set"]);
    const set = await ctx.store.getResultSet(resolved.targetId);
    if (!set) throw new ToolError("not_found", `${setRef} no longer exists. Search again.`);
    return set;
  }
  const latest = await ctx.store.latestResultSet();
  if (!latest) throw new ToolError("no_results", "There are no search results yet. Call search_jobs first.");
  return latest;
}

const triageInput = z
  .object({
    set_ref: refArg.optional().describe("Result set to triage (S#). Omit for the latest search."),
    max_years: z.number().int().min(0).max(20).optional().describe("Override the profile's max years for this triage only."),
    exclude_clearance_eligible: z.boolean().optional().describe("Also drop jobs that need you to be able to obtain a clearance."),
  })
  .strict();

export const triageResultsTool: NormalTool<z.infer<typeof triageInput>> = {
  name: "triage_results",
  description:
    "Read the requirements of the most promising jobs in a result set (years of experience, clearance, location type), drop the ones that fail the user's limits, and rank the rest against the profile. Returns ranked job refs with scores and the counts of what was dropped.",
  destructive: false,
  input: triageInput,
  async run(args, ctx) {
    const set = await resolveSet(ctx, args.set_ref);
    const stored = await loadProfile(ctx.store);
    const filters = toFilters(stored, { maxYears: args.max_years, excludeClearanceEligible: args.exclude_clearance_eligible });

    const postings = new Map((await ctx.store.getPostings(set.postingIds)).map((posting) => [posting.id, posting]));
    const jobs = set.postingIds.flatMap((id) => (postings.has(id) ? [toBoardJob(postings.get(id)!)] : []));
    const result = await ctx.services.triage(jobs, toTriageProfile(stored), filters, ctx.deadline);

    const refIds = [
      ...result.ranked.map((item) => item.job.postingId),
      ...result.dropped.map((item) => item.job.postingId),
      ...result.unread.map((item) => item.job.postingId),
      ...result.notChecked.slice(0, 25).map((job) => job.postingId),
    ];
    const refs = await assignRefs(ctx.store, "posting", refIds);

    const triage: StoredTriage = {
      triagedAt: ctx.now().toISOString(),
      filters,
      breakdown: result.breakdown,
      ranked: result.ranked.map((item) => ({ postingId: item.job.postingId, ref: refs.get(item.job.postingId)!, score: item.score, why: item.why, extraction: item.extraction })),
      dropped: result.dropped.map((item) => ({ postingId: item.job.postingId, ref: refs.get(item.job.postingId)!, reason: item.reason, evidence: item.evidence, extraction: item.extraction })),
      unread: result.unread.map((item) => ({ postingId: item.job.postingId, ref: refs.get(item.job.postingId)!, reason: item.reason })),
      notChecked: result.notChecked.map((job) => ({ postingId: job.postingId, ref: refs.get(job.postingId) ?? null })),
    };
    await ctx.store.saveRanked(set.id, triage);

    const byId = new Map(jobs.map((job) => [job.postingId, job]));
    const aiLimit = result.unread.some((item) => item.reason === "AI limit reached");
    const { breakdown } = result;
    return {
      summary: `${set.ref}: ${breakdown.checked} checked → ${breakdown.remaining} ranked, ${breakdown.droppedYears} dropped for years, ${breakdown.droppedClearance} for clearance, ${breakdown.unread} unread`,
      forModel: {
        set: set.ref,
        checked: breakdown.checked,
        ranked: breakdown.remaining,
        // Named exactly: the default filter drops ACTIVE-clearance jobs only (eligibility is opt-in).
        dropped: {
          too_many_years: breakdown.droppedYears,
          [filters.excludeClearanceEligible ? "needs_active_clearance_or_eligibility" : "needs_an_active_clearance_already_held"]: breakdown.droppedClearance,
        },
        unread: breakdown.unread,
        not_checked: breakdown.notChecked,
        limits_used: { max_years: filters.maxYears, exclude_clearance_eligible: filters.excludeClearanceEligible },
        ...(aiLimit ? { ai_limit_reached: true } : {}),
        top: result.ranked.slice(0, MODEL_TOP).map((item) => ({
          ...jobBrief(refs.get(item.job.postingId)!, byId.get(item.job.postingId)!),
          score: item.score.total,
          years_min: item.extraction.years_required_min,
          clearance: item.extraction.clearance_required,
          location_type: item.extraction.location_type,
          new_grad: item.extraction.is_new_grad_friendly,
        })),
      },
      forUI: {
        kind: "triage",
        set: set.ref,
        breakdown,
        searchBreakdown: set.breakdown,
        ranked: result.ranked.map((item) => ({ ref: refs.get(item.job.postingId)!, job: item.job, score: item.score, why: item.why, extraction: item.extraction })),
        dropped: result.dropped.map((item) => ({ ref: refs.get(item.job.postingId)!, job: item.job, reason: item.reason, evidence: item.evidence })),
        unread: result.unread.map((item) => ({ ref: refs.get(item.job.postingId)!, job: item.job, reason: item.reason })),
        notChecked: result.notChecked.map((job) => ({ ref: refs.get(job.postingId) ?? null, job })),
      },
    };
  },
};

const getPostingInput = z.object({ ref: refArg.describe("Job ref (J#)") }).strict();

export const getPostingTool: NormalTool<z.infer<typeof getPostingInput>> = {
  name: "get_posting",
  description: "Show one job's details (J#). The user sees the full posting in the app; you get the key facts and its requirement check, if it was triaged.",
  destructive: false,
  input: getPostingInput,
  async run(args, ctx) {
    const [resolved] = await resolveRefs(ctx.store, [args.ref], ["posting"]);
    const [posting] = await ctx.store.getPostings([resolved.targetId]);
    if (!posting) throw new ToolError("not_found", `${resolved.ref} no longer exists.`);

    const latest = await ctx.store.latestResultSet();
    const triage = latest && isStoredTriage(latest.ranked) ? latest.ranked : null;
    const ranked = triage?.ranked.find((item) => item.postingId === posting.id);
    const dropped = triage?.dropped.find((item) => item.postingId === posting.id);
    const extraction = ranked?.extraction ?? dropped?.extraction ?? null;
    const [application] = await ctx.store.listApplications({ postingIds: [posting.id] });
    const description = await ctx.store.getDescription(posting.id);

    return {
      summary: `${resolved.ref}: ${posting.title} at ${posting.company}`,
      forModel: {
        ...jobBrief(resolved.ref, posting),
        remote: posting.remote,
        posted: posting.postedAt?.slice(0, 10) ?? null,
        in_pipeline: application ? application.stage : false,
        requirements: extraction
          ? {
              years_min: extraction.years_required_min,
              clearance: extraction.clearance_required,
              location_type: extraction.location_type,
              degree: extraction.degree,
              new_grad: extraction.is_new_grad_friendly,
              score: ranked?.score.total ?? null,
              dropped_for: dropped?.reason ?? null,
            }
          : "not checked yet",
      },
      forUI: {
        kind: "posting",
        ref: resolved.ref,
        posting,
        description: clip(description, 20_000),
        extraction,
        score: ranked?.score ?? null,
        why: ranked?.why ?? null,
        droppedFor: dropped?.reason ?? null,
        stage: application?.stage ?? null,
      },
    };
  },
};
