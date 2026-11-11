"use client";

import type { ActionRecord } from "@/lib/agent/store";
import { formatDuration, timeAgo, toolLabel } from "@/lib/ui/format";
import { IconAlert, IconTerminal } from "./icons";
import { Button, EmptyState, StatusChip, Summary } from "./ui";

/** Every tool call, newest first: status, duration, and the exact arguments the model sent. */
export function ActionLog({ actions, onReview, now }: { actions: ActionRecord[]; onReview: (actionId: string) => void; now: number }) {
  if (actions.length === 0) {
    return <EmptyState title="Nothing yet" icon={<IconTerminal />}>Every tool call the agent makes is logged here with its arguments, status and duration.</EmptyState>;
  }
  return (
    <ol className="divide-y divide-border">
      {actions.map((action) => {
        const waiting = action.status === "awaiting_confirmation";
        return (
          <li key={action.id} className={`px-4 py-3 text-xs ${waiting ? "bg-warning-soft/60 shadow-[inset_2px_0_0_var(--warning)]" : ""}`}>
            <div className="flex items-center gap-2">
              <StatusChip status={action.status} ageSeconds={(now - Date.parse(action.createdAt)) / 1000} />
              <span className="min-w-0 truncate font-medium">{toolLabel(action.tool)}</span>
              {action.destructive && <span className="text-critical" title="Destructive: needs your confirmation"><IconAlert size={12} /><span className="sr-only">Destructive</span></span>}
              <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{formatDuration(action.durationMs)}</span>
            </div>
            {(action.resultSummary || action.error) && (
              <p className={`mt-1.5 leading-relaxed ${action.status === "failed" || action.status === "invalid" ? "text-critical" : "text-muted"}`}>{action.error && action.status !== "executed" ? action.error : action.resultSummary}</p>
            )}
            {waiting && (
              <Button size="sm" className="mt-2" onClick={() => onReview(action.id)}>Review and confirm</Button>
            )}
            <details className="mt-1.5">
              <Summary className="text-muted hover:text-foreground">
                Arguments <span className="ml-auto font-normal">{timeAgo(action.createdAt)}</span>
              </Summary>
              <pre className="scroll-thin mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(action.args, null, 2)}</pre>
              {action.resolvedArgs !== null && action.resolvedArgs !== undefined && (
                <>
                  <p className="mt-1.5 text-muted">Resolved by code (what runs on confirm):</p>
                  <pre className="scroll-thin mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(action.resolvedArgs, null, 2)}</pre>
                </>
              )}
            </details>
          </li>
        );
      })}
    </ol>
  );
}
