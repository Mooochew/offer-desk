import { STAGES, type Application, type Stage } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;

export type FunnelStats = {
  rangeDays: number;
  /** The cohort added within the range, and the furthest stage each reached. */
  funnel: { added: number; applied: number; responded: number; interviewed: number; offers: number };
  responseRate: number | null;
  pipelineNow: { active: number; by_stage: Record<Stage, number> };
  bySource: Record<string, number>;
};

/**
 * The job-search funnel, computed in code. Used by the get_funnel_stats tool and by the Funnel tab,
 * so the chat and the chart always agree. Everything past "saved" counts as applied (you can't get
 * a screen without applying); an archived application counts as applied if it has an applied date.
 */
export function computeFunnel(applications: readonly Application[], sourceOf: (postingId: string) => string, now: Date, rangeDays = 30): FunnelStats {
  const since = now.getTime() - rangeDays * DAY_MS;
  const byStage = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<Stage, number>;
  const bySource: Record<string, number> = {};
  for (const app of applications) {
    byStage[app.stage]++;
    const source = sourceOf(app.postingId);
    bySource[source] = (bySource[source] ?? 0) + 1;
  }

  const cohort = applications.filter((app) => Date.parse(app.createdAt) >= since);
  const reached = (stages: Stage[]) => cohort.filter((app) => stages.includes(app.stage) || (app.stage === "archived" && app.appliedAt !== null && stages.includes("applied"))).length;
  const funnel = {
    added: cohort.length,
    applied: reached(["applied", "screen", "interview", "offer", "rejected"]),
    responded: reached(["screen", "interview", "offer"]),
    interviewed: reached(["interview", "offer"]),
    offers: reached(["offer"]),
  };
  return {
    rangeDays,
    funnel,
    responseRate: funnel.applied ? Math.round((funnel.responded / funnel.applied) * 100) : null,
    pipelineNow: { active: applications.length - byStage.archived, by_stage: byStage },
    bySource,
  };
}
