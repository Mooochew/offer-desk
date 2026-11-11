"use client";

import type { ActionRecord } from "@/lib/agent/store";
import { formatDuration, timeAgo, toolLabel } from "@/lib/ui/format";
import { Button, EmptyState, StatusChip } from "./ui";

/** Every tool call, newest first: status, duration, and the exact arguments the model sent. */
export function ActionLog({ actions, onReview }: { actions: ActionRecord[]; onReview: (actionId: string) => void }) {
  if (actions.length === 0) {
    return <EmptyState title="Nothing yet">Every tool call the agent makes is logged here with its arguments, status and duration.</EmptyState>;
  }
  return (
    <ol className="space-y-1.5">
      {actions.map((action) => (
        <li key={action.id} className={`rounded-lg border bg-surface p-2 text-xs ${action.status === "awaiting_confirmation" ? "border-warning" : "border-border"}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip status={action.status} />
            <span className="font-medium">{toolLabel(action.tool)}</span>
            {action.destructive && <span className="text-critical" title="Destructive: needs your confirmation">⚠</span>}
            <span className="ml-auto text-muted">{formatDuration(action.durationMs)} · {timeAgo(action.createdAt)}</span>
          </div>
          {(action.resultSummary || action.error) && (
            <p className={`mt-1 ${action.status === "failed" || action.status === "invalid" ? "text-critical" : "text-muted"}`}>{action.error && action.status !== "executed" ? action.error : action.resultSummary}</p>
          )}
          {action.status === "awaiting_confirmation" && (
            <Button variant="secondary" className="mt-1.5" onClick={() => onReview(action.id)}>Review and confirm</Button>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer text-muted">Arguments</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-1.5 font-mono text-[11px]">{JSON.stringify(action.args, null, 2)}</pre>
            {action.resolvedArgs !== null && action.resolvedArgs !== undefined && (
              <>
                <p className="mt-1 text-muted">Resolved by code (what runs on confirm):</p>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-2 p-1.5 font-mono text-[11px]">{JSON.stringify(action.resolvedArgs, null, 2)}</pre>
              </>
            )}
          </details>
        </li>
      ))}
    </ol>
  );
}
