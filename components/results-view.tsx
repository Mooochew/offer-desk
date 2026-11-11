"use client";

import type { ResultsView } from "@/lib/agent/session-state";
import type { Extraction } from "@/lib/triage/schema";
import { DROP_REASON, funnelSteps, yearsLabel, type SearchBreakdown, type TriageBreakdown } from "@/lib/ui/format";
import { Badge, EmptyState, Ref } from "./ui";

export type SourceStatus = { source: string; boards: number; jobs: number; cached: number; refreshed: number; stale: number; failed: number; skipped: number };

function SourceChips({ sources, usedSnapshot }: { sources: SourceStatus[]; usedSnapshot: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {usedSnapshot && <Badge tone="warning">⚠ Live boards unavailable: showing the saved snapshot</Badge>}
      {sources.map((source) => {
        const down = source.failed + source.skipped;
        const label = source.source[0].toUpperCase() + source.source.slice(1);
        return (
          <span key={source.source} className="rounded-full border border-border bg-surface px-2 py-0.5" title={`${source.cached} cached · ${source.refreshed} refreshed · ${source.stale} stale · ${down} failed or skipped`}>
            {down ? "⚠" : "✓"} {label} {source.boards - down}/{source.boards} boards
          </span>
        );
      })}
    </div>
  );
}

/** The search → triage funnel as one-series horizontal bars with direct labels (and a table). */
function Breakdown({ search, triage }: { search: SearchBreakdown | null; triage: TriageBreakdown | null }) {
  const steps = funnelSteps(search, triage);
  if (steps.length === 0) return null;
  const max = steps[0].count || 1;
  return (
    <details className="group rounded-lg border border-border bg-surface p-3" open>
      <summary className="cursor-pointer text-sm font-medium">
        How {steps[0].count.toLocaleString()} jobs became {steps.at(-1)!.count.toLocaleString()}
        <span className="ml-2 text-xs font-normal text-muted">(all counts computed in code)</span>
      </summary>
      <ol className="mt-3 space-y-1.5" aria-label="Search funnel">
        {steps.map((step) => (
          <li key={step.label} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-xs sm:grid-cols-[11rem_1fr]" title={`${step.label}: ${step.count}${step.removed ? ` (${step.removed})` : ""}`}>
            <span className="truncate text-muted">{step.label}</span>
            <span className="flex items-center gap-2">
              {/* Linear from zero, so length stays honest; tiny steps get a visible stub and the exact count. */}
              <span className="h-3 rounded-r-[4px] bg-accent" style={{ width: `${Math.max(0.75, (step.count / max) * 70)}%` }} />
              <span className="font-medium tabular-nums">{step.count.toLocaleString()}</span>
              {step.removed && <span className="hidden text-muted sm:inline">{step.removed}</span>}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Evidence({ extraction }: { extraction: Extraction }) {
  const quotes = Object.entries(extraction.evidence).filter(([, quote]) => quote) as [string, string][];
  if (quotes.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-accent-strong">Evidence</summary>
      <ul className="mt-1 space-y-1 rounded bg-surface-2 p-2">
        {quotes.map(([field, quote]) => (
          <li key={field}>
            <span className="font-medium capitalize">{field.replace("_", "-")}:</span> <q className="italic">{quote}</q>
          </li>
        ))}
        <li className="text-muted">Quotes are copied from the posting and checked by code before they are used.</li>
      </ul>
    </details>
  );
}

function RankedCard({ item, index }: { item: ResultsView["ranked"][number]; index: number }) {
  const extraction = item.extraction as Extraction;
  const score = (item.score as { total?: number } | null)?.total;
  return (
    <li className="rounded-lg border border-border bg-surface p-3" data-company={item.job.company} data-ref={item.ref}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-6 text-right text-sm font-semibold tabular-nums text-muted">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Ref value={item.ref} />
            <a href={item.job.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{item.job.title}</a>
          </div>
          <p className="text-sm text-muted">{item.job.company} · {item.job.location ?? "location not listed"}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="accent">{yearsLabel(extraction.years_required_min)}</Badge>
            {extraction.location_type !== "unknown" && <Badge>{extraction.location_type}</Badge>}
            {extraction.is_new_grad_friendly === "yes" && <Badge tone="good">✓ new-grad friendly</Badge>}
            {extraction.clearance_required === "ability_to_obtain" && <Badge tone="warning">⚠ needs clearance eligibility</Badge>}
          </div>
          {item.why && <p className="text-xs text-muted">Why: {item.why}</p>}
          <Evidence extraction={extraction} />
        </div>
        {score !== undefined && (
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums">{score}</p>
            <p className="text-[11px] text-muted">score</p>
          </div>
        )}
      </div>
    </li>
  );
}

export function ResultsTab({ results, sources, usedSnapshot }: { results: ResultsView | null; sources: SourceStatus[]; usedSnapshot: boolean }) {
  if (!results) {
    return (
      <EmptyState title="No search yet">
        Try “Find entry-level backend and full-stack roles in SoCal or remote posted this week”.
      </EmptyState>
    );
  }
  const query = (results.query as { query?: string } | null)?.query;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <Ref value={results.set} /> <span className="text-muted">{query}</span>
        </p>
        <SourceChips sources={sources} usedSnapshot={usedSnapshot} />
      </div>
      <Breakdown search={results.searchBreakdown as SearchBreakdown | null} triage={results.breakdown as TriageBreakdown | null} />

      {results.triaged ? (
        results.ranked.length ? (
          <ol className="space-y-2">{results.ranked.map((item, index) => <RankedCard key={item.ref} item={item} index={index} />)}</ol>
        ) : (
          <EmptyState title="Nothing passed your requirements">Try a wider search, or raise your max years (“allow up to 3 years”).</EmptyState>
        )
      ) : (
        <>
          <p className="text-sm text-muted">Requirements not checked yet. Ask the agent to triage these results.</p>
          <ul className="space-y-1.5">
            {results.jobs.map((job) => (
              <li key={job.postingId} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2.5 text-sm">
                <Ref value={job.ref} />
                <a href={job.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{job.title}</a>
                <span className="text-muted">· {job.company}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {results.dropped.length > 0 && (
        <details className="rounded-lg border border-border bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium">Dropped by your requirements ({results.dropped.length})</summary>
          <ul className="mt-2 space-y-2">
            {results.dropped.map((item) => (
              <li key={item.ref} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Ref value={item.ref} />
                  <a href={item.job.url} target="_blank" rel="noreferrer" className="hover:underline">{item.job.title}</a>
                  <span className="text-muted">· {item.job.company}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{DROP_REASON[item.reason] ?? item.reason}{item.evidence && <>: <q className="italic">{item.evidence}</q></>}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {(results.unread.length > 0 || results.notChecked.length > 0) && (
        <details className="rounded-lg border border-border bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium">Not checked ({results.unread.length + results.notChecked.length})</summary>
          <p className="mt-1 text-xs text-muted">Kept visible, never silently dropped: open them to check yourself.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {results.unread.map((item) => (
              <li key={item.ref}><Ref value={item.ref} /> <a href={item.job.url} target="_blank" rel="noreferrer" className="hover:underline">{item.job.title}</a> <span className="text-muted">· {item.job.company} · {item.reason}</span></li>
            ))}
            {results.notChecked.map((item) => (
              <li key={item.job.postingId}><Ref value={item.ref} /> <a href={item.job.url} target="_blank" rel="noreferrer" className="hover:underline">{item.job.title}</a> <span className="text-muted">· {item.job.company} · over the 25-posting limit</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

