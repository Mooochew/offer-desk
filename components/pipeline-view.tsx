"use client";

import { useMemo, useState } from "react";
import { computeFunnel } from "@/lib/agent/funnel";
import type { PipelineItem } from "@/lib/agent/session-state";
import { timeAgo } from "@/lib/ui/format";
import { IconCalendar, IconLayers, IconNote } from "./icons";
import { Button, EmptyState, Ref } from "./ui";

const COLUMNS = ["saved", "applied", "screen", "interview", "offer", "rejected"] as const;
const COLUMN_LABEL: Record<string, string> = { saved: "Saved", applied: "Applied", screen: "Screen", interview: "Interview", offer: "Offer", rejected: "Rejected", archived: "Archived" };

function Card({ item }: { item: PipelineItem }) {
  const next = item.application.nextStepAt;
  return (
    <li className="rounded-md border border-border bg-surface p-2.5 text-xs shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      <a href={item.posting.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[13px] font-medium leading-snug hover:underline" title={item.posting.title}>{item.posting.title}</a>
      <p className="mt-1 truncate text-muted">{item.posting.company}</p>
      {next && (
        <p className="mt-2 flex items-center gap-1.5 font-medium">
          <IconCalendar size={12} className="text-accent" />
          {new Date(next).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      )}
      {item.application.notes && (
        <p className="mt-2 flex gap-1.5 text-muted" title={item.application.notes}>
          <IconNote size={12} className="mt-px shrink-0" />
          <span className="line-clamp-2">{item.application.notes.split("\n").at(-1)}</span>
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>touched {timeAgo(item.application.updatedAt)}</span>
        <Ref value={item.ref} />
      </div>
    </li>
  );
}

export function PipelineTab({ pipeline }: { pipeline: PipelineItem[] }) {
  const [showArchived, setShowArchived] = useState(false);
  if (pipeline.length === 0) {
    return <EmptyState title="Your pipeline is empty" icon={<IconLayers />}>Save jobs from a search (“save the top 5”), or click <b className="text-foreground">Seed sample pipeline</b>.</EmptyState>;
  }
  const archived = pipeline.filter((item) => item.application.stage === "archived");
  const sorted = [...pipeline].sort((a, b) => b.application.updatedAt.localeCompare(a.application.updatedAt));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        {COLUMNS.map((stage) => {
          const items = sorted.filter((item) => item.application.stage === stage);
          return (
            <section key={stage} className="rounded-lg bg-surface-2/70 p-2" aria-label={`${COLUMN_LABEL[stage]} column`}>
              <h3 className="mb-2 flex items-center justify-between px-1 pt-0.5 text-xs font-medium">
                {COLUMN_LABEL[stage]} <span className="tabular-nums text-muted">{items.length}</span>
              </h3>
              {items.length ? <ul className="space-y-2">{items.map((item) => <Card key={item.application.id} item={item} />)}</ul> : <p className="rounded-md border border-dashed border-border px-2 py-4 text-center text-[11px] text-muted">None</p>}
            </section>
          );
        })}
      </div>
      {archived.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Hide" : "Show"} archived ({archived.length})</Button>
          {showArchived && <ul className="mt-2 grid grid-cols-2 gap-2 opacity-80 lg:grid-cols-4">{archived.map((item) => <Card key={item.application.id} item={item} />)}</ul>}
        </div>
      )}
    </div>
  );
}

const RANGES = [7, 30, 90] as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export function FunnelTab({ pipeline, range, onRange: setRange }: { pipeline: PipelineItem[]; range: number; onRange: (days: number) => void }) {
  const [asTable, setAsTable] = useState(false);
  const stats = useMemo(() => {
    const sources = new Map(pipeline.map((item) => [item.posting.id, item.posting.source]));
    return computeFunnel(pipeline.map((item) => item.application), (id) => sources.get(id) ?? "unknown", new Date(), range);
  }, [pipeline, range]);

  if (pipeline.length === 0) return <EmptyState title="No applications yet" icon={<IconLayers />}>The funnel fills in as you save and apply to jobs.</EmptyState>;

  const bars = [
    { label: "Added", count: stats.funnel.added },
    { label: "Applied", count: stats.funnel.applied },
    { label: "Got a response", count: stats.funnel.responded },
    { label: "Interviewed", count: stats.funnel.interviewed },
    { label: "Offers", count: stats.funnel.offers },
  ];
  const max = Math.max(1, bars[0].count);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Funnel options">
        <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
          {[...new Set<number>([...RANGES, range])].sort((a, b) => a - b).map((days) => (
            <button key={days} type="button" onClick={() => setRange(days)} aria-pressed={range === days} className={`h-7 rounded px-2.5 text-xs font-medium transition-colors ${range === days ? "bg-ink text-ink-fg" : "text-muted hover:text-foreground"}`}>
              Last {days} days
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>{asTable ? "Show chart" : "Show table"}</Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label={`Added · ${range} days`} value={String(stats.funnel.added)} />
        <Stat label="Applied" value={String(stats.funnel.applied)} />
        <Stat label="Response rate" value={stats.responseRate === null ? "n/a" : `${stats.responseRate}%`} hint="screen, interview or offer" />
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-medium">Applications added in the last {range} days, and how far they got</h3>
        <p className="mb-4 text-xs text-muted">Computed in code from your pipeline.</p>
        {asTable ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1.5 font-medium">Stage reached</th><th className="py-1.5 text-right font-medium">Applications</th><th className="py-1.5 text-right font-medium">Share of added</th></tr></thead>
            <tbody>{bars.map((bar) => <tr key={bar.label} className="border-t border-border"><td className="py-1.5">{bar.label}</td><td className="py-1.5 text-right tabular-nums">{bar.count}</td><td className="py-1.5 text-right tabular-nums">{stats.funnel.added ? Math.round((bar.count / stats.funnel.added) * 100) : 0}%</td></tr>)}</tbody>
          </table>
        ) : (
          <ol className="space-y-2.5" aria-label="Funnel chart">
            {bars.map((bar) => (
              <li key={bar.label} className="group grid grid-cols-[7.5rem_1fr] items-center gap-3 text-sm">
                <span className="text-muted">{bar.label}</span>
                <span className="relative flex items-center gap-2.5">
                  {bar.count > 0 && <span className="h-5 rounded-sm bg-accent transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(0.75, (bar.count / max) * 80)}%` }} />}
                  <span className="font-medium tabular-nums">{bar.count}</span>
                  <span role="tooltip" className="pointer-events-none absolute -top-7 left-0 hidden rounded bg-ink px-2 py-0.5 text-xs text-ink-fg group-hover:block">
                    {bar.label}: {bar.count} ({stats.funnel.added ? Math.round((bar.count / stats.funnel.added) * 100) : 0}% of added)
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-2 text-sm font-medium">Pipeline right now <span className="font-normal text-muted">· {stats.pipelineNow.active} active</span></h3>
          <table className="w-full text-sm"><tbody>
            {Object.entries(stats.pipelineNow.by_stage).map(([stage, count]) => <tr key={stage} className="border-t border-border first:border-0"><td className="py-1.5 text-muted">{COLUMN_LABEL[stage]}</td><td className="py-1.5 text-right tabular-nums">{count}</td></tr>)}
          </tbody></table>
        </section>
        <section className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-2 text-sm font-medium">By job source <span className="font-normal text-muted">· all time</span></h3>
          <table className="w-full text-sm"><tbody>
            {Object.entries(stats.bySource).map(([source, count]) => <tr key={source} className="border-t border-border first:border-0"><td className="py-1.5 capitalize text-muted">{source}</td><td className="py-1.5 text-right tabular-nums">{count}</td></tr>)}
          </tbody></table>
        </section>
      </div>
    </div>
  );
}
