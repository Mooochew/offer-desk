"use client";

import type { ResultsView } from "@/lib/agent/session-state";
import type { Extraction } from "@/lib/triage/schema";
import { DROP_REASON, funnelSteps, yearsLabel, type SearchBreakdown, type TriageBreakdown } from "@/lib/ui/format";
import { IconAlert, IconCheck, IconExternal, IconSearch } from "./icons";
import { Badge, EmptyState, Ref, Summary } from "./ui";

export type SourceStatus = { source: string; boards: number; jobs: number; cached: number; refreshed: number; stale: number; failed: number; skipped: number };

function SourceChips({ sources, usedSnapshot }: { sources: SourceStatus[]; usedSnapshot: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {usedSnapshot && <Badge tone="warning"><IconAlert size={11} /> Live boards unavailable: showing the saved snapshot</Badge>}
      {sources.map((source) => {
        const down = source.failed + source.skipped;
        const label = source.source[0].toUpperCase() + source.source.slice(1);
        return (
          <span key={source.source} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-muted" title={`${source.cached} cached · ${source.refreshed} refreshed · ${source.stale} stale · ${down} failed or skipped`}>
            {down ? <IconAlert size={12} className="text-warning" /> : <IconCheck size={12} className="text-good" />}
            <span className="font-medium text-foreground">{label}</span> {source.boards - down}/{source.boards} boards
          </span>
        );
      })}
    </div>
  );
}

/** The search → triage funnel as one-series horizontal bars with direct labels. */
function Breakdown({ search, triage }: { search: SearchBreakdown | null; triage: TriageBreakdown | null }) {
  const steps = funnelSteps(search, triage);
  if (steps.length === 0) return null;
  const max = steps[0].count || 1;
  return (
    <details className="rounded-lg border border-border bg-surface" open>
      <Summary className="px-4 py-3 text-sm font-medium">
        How {steps[0].count.toLocaleString()} jobs became {steps.at(-1)!.count.toLocaleString()}
        <span className="ml-auto text-xs font-normal text-muted">All counts computed in code</span>
      </Summary>
      <ol className="space-y-1 border-t border-border px-4 py-3" aria-label="Search funnel">
        {steps.map((step, index) => (
          <li key={step.label} className="grid grid-cols-[9rem_1fr] items-center gap-3 text-xs sm:grid-cols-[10.5rem_1fr]" title={`${step.label}: ${step.count}${step.removed ? ` (${step.removed})` : ""}`}>
            <span className={`truncate ${index === steps.length - 1 ? "font-medium text-foreground" : "text-muted"}`}>{step.label}</span>
            <span className="flex h-5 items-center gap-2">
              {/* Linear from zero, so length stays honest; tiny steps get a visible stub and the exact count. */}
              {step.count > 0 && <span className={`h-2.5 rounded-sm ${index === steps.length - 1 ? "bg-accent" : "bg-accent/70"}`} style={{ width: `${Math.max(0.75, (step.count / max) * 68)}%` }} />}
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
      <Summary className="w-fit text-muted hover:text-foreground">Evidence</Summary>
      <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
        {quotes.map(([field, quote]) => (
          <li key={field}>
            <span className="font-medium capitalize">{field.replace("_", "-")}</span> <q className="text-muted">{quote}</q>
          </li>
        ))}
        <li className="text-[11px] text-muted">Quotes are copied from the posting and checked by code before they are used.</li>
      </ul>
    </details>
  );
}

function ScoreMeter({ score }: { score: number }) {
  return (
    <div className="w-14 shrink-0 text-right" title={`Match score ${score} of 100, computed in code`}>
      <p className="text-lg font-semibold leading-none tabular-nums">{score}</p>
      <p className="mt-1 text-[10px] text-muted">of 100</p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
      </div>
    </div>
  );
}

function RankedCard({ item, index }: { item: ResultsView["ranked"][number]; index: number }) {
  const extraction = item.extraction as Extraction;
  const score = (item.score as { total?: number } | null)?.total;
  return (
    <li className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong" data-company={item.job.company} data-ref={item.ref}>
      <div className="flex items-start gap-4">
        <span className="w-5 pt-0.5 text-right font-mono text-xs text-muted">{String(index + 1).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <a href={item.job.url} target="_blank" rel="noreferrer" className="group inline-flex items-baseline gap-1.5 font-medium leading-snug hover:underline">
              {item.job.title}
              <IconExternal size={12} className="shrink-0 translate-y-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
              <span className="font-medium text-foreground/80">{item.job.company}</span>
              <span aria-hidden>·</span>
              <span>{item.job.location ?? "location not listed"}</span>
              <Ref value={item.ref} />
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="accent">{yearsLabel(extraction.years_required_min)}</Badge>
            {extraction.location_type !== "unknown" && <Badge tone="outline">{extraction.location_type}</Badge>}
            {extraction.is_new_grad_friendly === "yes" && <Badge tone="good"><IconCheck size={11} /> new-grad friendly</Badge>}
            {extraction.clearance_required === "ability_to_obtain" && <Badge tone="warning"><IconAlert size={11} /> needs clearance eligibility</Badge>}
          </div>
          {item.why && <p className="text-xs leading-relaxed text-muted"><span className="font-medium text-foreground/80">Why</span> · {item.why}</p>}
          <Evidence extraction={extraction} />
        </div>
        {score !== undefined && <ScoreMeter score={score} />}
      </div>
    </li>
  );
}

function JobLine({ ref_, url, title, company, extra }: { ref_: string | null | undefined; url: string; title: string; company: string; extra?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Ref value={ref_} />
      <a href={url} target="_blank" rel="noreferrer" className="hover:underline">{title}</a>
      <span className="text-muted">· {company}{extra ? ` · ${extra}` : ""}</span>
    </div>
  );
}

export function ResultsTab({ results, sources, usedSnapshot }: { results: ResultsView | null; sources: SourceStatus[]; usedSnapshot: boolean }) {
  if (!results) {
    return (
      <EmptyState title="No search yet" icon={<IconSearch />}>
        Try “Find entry-level backend and full-stack roles in SoCal or remote posted this week”.
      </EmptyState>
    );
  }
  const query = (results.query as { query?: string } | null)?.query;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <Ref value={results.set} /> <span className="truncate font-medium">{query}</span>
        </p>
        <SourceChips sources={sources} usedSnapshot={usedSnapshot} />
      </div>
      <Breakdown search={results.searchBreakdown as SearchBreakdown | null} triage={results.breakdown as TriageBreakdown | null} />

      {results.triaged ? (
        results.ranked.length ? (
          <section>
            <h3 className="mb-2 text-xs font-medium text-muted">Ranked for your profile · {results.ranked.length}</h3>
            <ol className="space-y-2">{results.ranked.map((item, index) => <RankedCard key={item.ref} item={item} index={index} />)}</ol>
          </section>
        ) : (
          <EmptyState title="Nothing passed your requirements">Try a wider search, or raise your max years (“allow up to 3 years”).</EmptyState>
        )
      ) : (
        <>
          <p className="text-sm text-muted">Requirements not checked yet. Ask the agent to triage these results.</p>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {results.jobs.map((job) => (
              <li key={job.postingId} className="px-3 py-2"><JobLine ref_={job.ref} url={job.url} title={job.title} company={job.company} /></li>
            ))}
          </ul>
        </>
      )}

      {results.dropped.length > 0 && (
        <details className="rounded-lg border border-border bg-surface">
          <Summary className="px-4 py-3 text-sm font-medium">Dropped by your requirements <span className="font-normal text-muted">({results.dropped.length})</span></Summary>
          <ul className="space-y-3 border-t border-border px-4 py-3">
            {results.dropped.map((item) => (
              <li key={item.ref} className="text-sm">
                <JobLine ref_={item.ref} url={item.job.url} title={item.job.title} company={item.job.company} />
                <p className="mt-1 text-xs text-muted">{DROP_REASON[item.reason] ?? item.reason}{item.evidence && <>: <q>{item.evidence}</q></>}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {(results.unread.length > 0 || results.notChecked.length > 0) && (
        <details className="rounded-lg border border-border bg-surface">
          <Summary className="px-4 py-3 text-sm font-medium">Not checked <span className="font-normal text-muted">({results.unread.length + results.notChecked.length})</span></Summary>
          <div className="border-t border-border px-4 py-3">
            <p className="mb-2 text-xs text-muted">Kept visible, never silently dropped: open them to check yourself.</p>
            <ul className="space-y-1.5 text-sm">
              {results.unread.map((item) => (
                <li key={item.ref}><JobLine ref_={item.ref} url={item.job.url} title={item.job.title} company={item.job.company} extra={item.reason} /></li>
              ))}
              {results.notChecked.map((item) => (
                <li key={item.job.postingId}><JobLine ref_={item.ref} url={item.job.url} title={item.job.title} company={item.job.company} extra="over the 25-posting limit" /></li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}
