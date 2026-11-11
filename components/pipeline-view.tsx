"use client";

import { useMemo, useState } from "react";
import { computeFunnel } from "@/lib/agent/funnel";
import type { PipelineItem } from "@/lib/agent/session-state";
import { timeAgo } from "@/lib/ui/format";
import { Button, EmptyState, Ref } from "./ui";

const COLUMNS = ["saved", "applied", "screen", "interview", "offer", "rejected"] as const;
const COLUMN_LABEL: Record<string, string> = { saved: "Saved", applied: "Applied", screen: "Screen", interview: "Interview", offer: "Offer", rejected: "Rejected", archived: "Archived" };

function Card({ item }: { item: PipelineItem }) {
  const next = item.application.nextStepAt;
  return (
    <li className="rounded-md border border-border bg-surface p-2 text-xs">
      <div className="flex items-start gap-1.5">
        <Ref value={item.ref} />
        <a href={item.posting.url} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium hover:underline" title={item.posting.title}>{item.posting.title}</a>
      </div>
      <p className="mt-0.5 truncate text-muted">{item.posting.company}</p>
      <p className="mt-0.5 text-muted">touched {timeAgo(item.application.updatedAt)}</p>
      {next && <p className="mt-0.5 font-medium">Next: {new Date(next).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
      {item.application.notes && <p className="mt-1 line-clamp-2 text-muted" title={item.application.notes}>📝 {item.application.notes.split("\n").at(-1)}</p>}
    </li>
  );
}

export function PipelineTab({ pipeline }: { pipeline: PipelineItem[] }) {
  const [showArchived, setShowArchived] = useState(false);
  if (pipeline.length === 0) {
    return <EmptyState title="Your pipeline is empty">Save jobs from a search (“save the top 5”), or click <b>Seed sample pipeline</b>.</EmptyState>;
  }
  const archived = pipeline.filter((item) => item.application.stage === "archived");
  const sorted = [...pipeline].sort((a, b) => b.application.updatedAt.localeCompare(a.application.updatedAt));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">
        {COLUMNS.map((stage) => {
          const items = sorted.filter((item) => item.application.stage === stage);
          return (
            <section key={stage} className="rounded-lg bg-surface-2 p-2" aria-label={`${COLUMN_LABEL[stage]} column`}>
              <h3 className="mb-2 flex justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                {COLUMN_LABEL[stage]} <span className="tabular-nums">{items.length}</span>
              </h3>
              <ul className="space-y-1.5">{items.map((item) => <Card key={item.application.id} item={item} />)}</ul>
            </section>
          );
        })}
      </div>
      {archived.length > 0 && (
        <div>
          <Button variant="ghost" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Hide" : "Show"} archived ({archived.length})</Button>
          {showArchived && <ul className="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-4">{archived.map((item) => <Card key={item.application.id} item={item} />)}</ul>}
        </div>
      )}
    </div>
  );
}

const RANGES = [7, 30, 90] as const;

export function FunnelTab({ pipeline }: { pipeline: PipelineItem[] }) {
  const [range, setRange] = useState<number>(30);
  const [asTable, setAsTable] = useState(false);
  const stats = useMemo(() => {
    const sources = new Map(pipeline.map((item) => [item.posting.id, item.posting.source]));
    return computeFunnel(pipeline.map((item) => item.application), (id) => sources.get(id) ?? "unknown", new Date(), range);
  }, [pipeline, range]);

  if (pipeline.length === 0) return <EmptyState title="No applications yet">The funnel fills in as you save and apply to jobs.</EmptyState>;

  const bars = [
    { label: "Added", count: stats.funnel.added },
    { label: "Applied", count: stats.funnel.applied },
    { label: "Got a response", count: stats.funnel.responded },
    { label: "Interviewed", count: stats.funnel.interviewed },
    { label: "Offers", count: stats.funnel.offers },
  ];
  const max = Math.max(1, bars[0].count);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Funnel options">
        {RANGES.map((days) => (
          <Button key={days} variant={range === days ? "primary" : "secondary"} onClick={() => setRange(days)} aria-pressed={range === days}>Last {days} days</Button>
        ))}
        <Button variant="ghost" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>{asTable ? "Show chart" : "Show table"}</Button>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">Applications added in the last {range} days, and how far they got</h3>
        <p className="mb-3 text-xs text-muted">
          Response rate: <b className="text-foreground">{stats.responseRate === null ? "n/a" : `${stats.responseRate}%`}</b> of applied (screen, interview or offer). Computed in code.
        </p>
        {asTable ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Stage reached</th><th className="py-1 text-right font-medium">Applications</th><th className="py-1 text-right font-medium">Share of added</th></tr></thead>
            <tbody>{bars.map((bar) => <tr key={bar.label} className="border-t border-border"><td className="py-1">{bar.label}</td><td className="py-1 text-right tabular-nums">{bar.count}</td><td className="py-1 text-right tabular-nums">{stats.funnel.added ? Math.round((bar.count / stats.funnel.added) * 100) : 0}%</td></tr>)}</tbody>
          </table>
        ) : (
          <ol className="space-y-2" aria-label="Funnel chart">
            {bars.map((bar) => (
              <li key={bar.label} className="group grid grid-cols-[8rem_1fr] items-center gap-2 text-sm">
                <span className="text-muted">{bar.label}</span>
                <span className="relative flex items-center gap-2">
                  <span className="h-6 rounded-r-[4px] bg-accent transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(0.75, (bar.count / max) * 80)}%` }} />
                  <span className="font-semibold tabular-nums">{bar.count}</span>
                  <span role="tooltip" className="pointer-events-none absolute -top-7 left-0 hidden rounded bg-foreground px-2 py-0.5 text-xs text-background group-hover:block">
                    {bar.label}: {bar.count} ({stats.funnel.added ? Math.round((bar.count / stats.funnel.added) * 100) : 0}% of added)
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-3">
          <h3 className="mb-2 text-sm font-semibold">Pipeline right now <span className="font-normal text-muted">({stats.pipelineNow.active} active)</span></h3>
          <table className="w-full text-sm"><tbody>
            {Object.entries(stats.pipelineNow.by_stage).map(([stage, count]) => <tr key={stage} className="border-t border-border first:border-0"><td className="py-1 text-muted">{COLUMN_LABEL[stage]}</td><td className="py-1 text-right tabular-nums">{count}</td></tr>)}
          </tbody></table>
        </section>
        <section className="rounded-lg border border-border bg-surface p-3">
          <h3 className="mb-2 text-sm font-semibold">By job source <span className="font-normal text-muted">(all time)</span></h3>
          <table className="w-full text-sm"><tbody>
            {Object.entries(stats.bySource).map(([source, count]) => <tr key={source} className="border-t border-border first:border-0"><td className="py-1 capitalize text-muted">{source}</td><td className="py-1 text-right tabular-nums">{count}</td></tr>)}
          </tbody></table>
        </section>
      </div>
    </div>
  );
}
