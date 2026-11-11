"use client";

import { useEffect, useRef, useState } from "react";
import type { TurnEvent } from "@/lib/agent/loop";
import { formatDuration, toolLabel } from "@/lib/ui/format";
import { AnswerText, Button, Spinner, StatusChip } from "./ui";

export type ChatTurn = {
  id: string;
  message: string;
  state: "running" | "done" | "error";
  events: TurnEvent[];
  final: string;
  error?: string;
};

export const SUGGESTIONS = [
  "Find entry-level backend and full-stack roles in SoCal or remote posted this week",
  "Save the top 5 and give me an apply checklist",
  "Mark the first 5 as applied today",
  "Archive everything I haven't touched in 3 weeks",
  "Show my funnel this month",
  "Export my pipeline as a CSV",
];

type FilePayload = { kind: "file"; ref: string; fileId: string; fileKind: string; filename: string; rows?: number; jobs?: number; startsLocal?: string };

function FileCard({ file, onDownload }: { file: FilePayload; onDownload: (fileId: string) => void }) {
  const detail = file.startsLocal ?? (file.rows !== undefined ? `${file.rows} rows` : file.jobs !== undefined ? `${file.jobs} jobs` : "");
  const icon = file.fileKind === "ics" ? "📅" : file.fileKind === "csv" ? "📊" : "📝";
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2.5">
      <span aria-hidden className="text-xl">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.filename}</p>
        <p className="text-xs text-muted">{file.ref} · {detail}</p>
      </div>
      <Button variant="secondary" onClick={() => onDownload(file.fileId)}>Download</Button>
    </div>
  );
}

function Timeline({ events, actionStatus }: { events: TurnEvent[]; actionStatus: Map<string, string> }) {
  const steps = events.filter((event): event is Extract<TurnEvent, { type: "step_done" }> => event.type === "step_done");
  if (steps.length === 0) return null;
  return (
    <ol className="my-2 space-y-1 border-l-2 border-border pl-3">
      {steps.map((step) => (
        <li key={step.actionId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {/* The current status (a proposal becomes Done or Cancelled later), not the one frozen at turn end. */}
          <StatusChip status={actionStatus.get(step.actionId) ?? step.status} />
          <span className="font-medium">{toolLabel(step.tool)}</span>
          <span className="text-muted">{step.summary}</span>
          <span className="text-muted">· {formatDuration(step.durationMs)}</span>
        </li>
      ))}
    </ol>
  );
}

export function ChatPanel({
  history,
  turns,
  busy,
  onSend,
  onDownload,
  onReview,
  actionStatus,
}: {
  history: { role: string; content: string }[];
  turns: ChatTurn[];
  busy: boolean;
  onSend: (message: string) => void;
  onDownload: (fileId: string) => void;
  onReview: (actionId: string) => void;
  /** Current status of each logged action, so a handled proposal stops asking for confirmation. */
  actionStatus: Map<string, string>;
}) {
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chromium returns a Promise from scrollIntoView, and an effect must return
  // nothing or a cleanup function (returning the Promise crashed the page).
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, history.length]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    onSend(message);
    setDraft("");
  };
  const empty = history.length === 0 && turns.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {empty && (
          <div className="rounded-lg bg-surface-2 p-3 text-sm text-muted">
            <p className="font-medium text-foreground">Start here</p>
            <p className="mt-1">Click <b>Load demo profile</b> (and <b>Seed sample pipeline</b> for the archive demo), then try a suggestion below. Every action the agent takes shows in the action log.</p>
          </div>
        )}
        {history.map((message, index) => (
          <div key={`h${index}`} className={message.role === "user" ? "ml-8 rounded-lg bg-accent-soft p-2.5 text-sm" : "mr-4"}>
            {message.role === "user" ? message.content : <AnswerText text={message.content} />}
          </div>
        ))}
        {turns.map((turn) => {
          const files = turn.events.filter((event) => event.type === "ui_payload" && event.payload.kind === "file").map((event) => (event as unknown as { payload: FilePayload }).payload);
          const pending = turn.events.filter((event): event is Extract<TurnEvent, { type: "pending_action" }> => event.type === "pending_action");
          return (
            <div key={turn.id} className="space-y-1.5">
              <div className="ml-8 rounded-lg bg-accent-soft p-2.5 text-sm">{turn.message}</div>
              <div className="mr-4">
                {turn.state === "running" && (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <Spinner /> Working on it… searching and reading postings can take 10–20 seconds.
                  </p>
                )}
                <Timeline events={turn.events} actionStatus={actionStatus} />
                {turn.state === "error" && <p className="text-sm text-critical">{turn.error}</p>}
                {turn.final && <AnswerText text={turn.final} />}
                <div className="mt-2 space-y-2">
                  {files.map((file) => <FileCard key={file.fileId} file={file} onDownload={onDownload} />)}
                  {pending.map((item) => {
                    const status = actionStatus.get(item.actionId) ?? "awaiting_confirmation";
                    return status === "awaiting_confirmation" ? (
                      <div key={item.actionId} className="flex items-center justify-between gap-2 rounded-lg border border-warning bg-warning-soft p-2.5 text-sm">
                        <span><span aria-hidden>⏸ </span>{item.preview.title} Waiting for your confirmation.</span>
                        <Button variant="secondary" onClick={() => onReview(item.actionId)}>Review</Button>
                      </div>
                    ) : (
                      <div key={item.actionId} className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm">
                        <StatusChip status={status} />
                        <span className="text-muted">{item.preview.title.replace(/\?$/, "")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="border-t border-border p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" disabled={busy} onClick={() => send(suggestion)} className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-foreground disabled:opacity-50">
              {suggestion}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <label htmlFor="chat-input" className="sr-only">Message</label>
          <textarea
            id="chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder="Ask in plain English, e.g. “find new-grad backend roles in Seattle or remote”"
            className="min-h-[2.75rem] flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted"
          />
          <Button type="submit" variant="primary" disabled={busy || !draft.trim()} className="self-end" aria-label={busy ? "Sending" : "Send"}>
            {busy ? <Spinner /> : "Send"}
          </Button>
        </form>
      </div>
    </div>
  );
}
