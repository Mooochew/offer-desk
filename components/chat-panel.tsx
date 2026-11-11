"use client";

import { useEffect, useRef, useState } from "react";
import type { TurnEvent } from "@/lib/agent/loop";
import { formatDuration, toolLabel } from "@/lib/ui/format";
import { FileIcon, IconChevron, IconDownload, IconPause, IconSend } from "./icons";
import { AnswerText, Button, PanelHeader, Spinner, StatusChip } from "./ui";

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
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-2 pr-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
        <FileIcon kind={file.fileKind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.filename}</p>
        <p className="text-xs text-muted">{file.ref}{detail ? ` · ${detail}` : ""}</p>
      </div>
      <Button size="sm" onClick={() => onDownload(file.fileId)}>
        <IconDownload size={13} /> Download
      </Button>
    </div>
  );
}

function Timeline({ events, actionStatus }: { events: TurnEvent[]; actionStatus: Map<string, string> }) {
  const steps = events.filter((event): event is Extract<TurnEvent, { type: "step_done" }> => event.type === "step_done");
  if (steps.length === 0) return null;
  return (
    <ol className="mb-2.5 divide-y divide-border rounded-lg border border-border bg-surface text-xs" aria-label="Steps">
      {steps.map((step) => (
        <li key={step.actionId} className="flex items-center gap-2 px-2.5 py-1.5">
          {/* The current status (a proposal becomes Done or Cancelled later), not the one frozen at turn end. */}
          <StatusChip status={actionStatus.get(step.actionId) ?? step.status} />
          <span className="shrink-0 font-medium">{toolLabel(step.tool)}</span>
          <span className="min-w-0 flex-1 truncate text-muted" title={step.summary}>{step.summary}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted">{formatDuration(step.durationMs)}</span>
        </li>
      ))}
    </ol>
  );
}

function UserMessage({ children }: { children: string }) {
  return (
    <div data-role="user" className="ml-auto w-fit max-w-[88%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-surface-2 px-3 py-2 text-sm">
      {children}
    </div>
  );
}

function Welcome({ onPick, busy }: { onPick: (text: string) => void; busy: boolean }) {
  return (
    <div className="space-y-6 pt-2">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Start here</h2>
        <p className="mt-1 text-sm text-muted">Offer Desk searches real job boards, reads each posting for the actual requirements, and tracks what you apply to. Every action it takes shows in the action log.</p>
      </div>
      <ol className="space-y-2.5 text-sm">
        {[
          ["Load demo profile", "a new-grad CS profile, SoCal or remote"],
          ["Seed sample pipeline", "optional; a few old applications for the archive demo"],
          ["Ask in plain English", "or pick a prompt below"],
        ].map(([title, detail], index) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-[11px] text-muted">{index + 1}</span>
            <span><span className="font-medium">{title}</span> <span className="text-muted">· {detail}</span></span>
          </li>
        ))}
      </ol>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Try asking</p>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {SUGGESTIONS.slice(0, 4).map((suggestion) => (
            <li key={suggestion}>
              <button type="button" disabled={busy} onClick={() => onPick(suggestion)} className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-50">
                <span className="flex-1">{suggestion}</span>
                <IconChevron size={12} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
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
      {/* On phones the panel tabs already say "Chat". */}
      <div className="hidden md:block">
        <PanelHeader>
          <h2 className="text-sm font-medium">Chat</h2>
          {busy && <span className="ml-auto flex items-center gap-1.5 text-xs text-muted"><Spinner className="h-3 w-3" /> Working</span>}
        </PanelHeader>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {empty && <Welcome onPick={send} busy={busy} />}
        {history.map((message, index) =>
          message.role === "user" ? <UserMessage key={`h${index}`}>{message.content}</UserMessage> : <AnswerText key={`h${index}`} text={message.content} />,
        )}
        {turns.map((turn) => {
          const files = turn.events.filter((event) => event.type === "ui_payload" && event.payload.kind === "file").map((event) => (event as unknown as { payload: FilePayload }).payload);
          const pending = turn.events.filter((event): event is Extract<TurnEvent, { type: "pending_action" }> => event.type === "pending_action");
          return (
            <div key={turn.id} className="space-y-3">
              <UserMessage>{turn.message}</UserMessage>
              <div>
                {turn.state === "running" && (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <Spinner /> Working on it… searching and reading postings can take 10–20 seconds.
                  </p>
                )}
                <Timeline events={turn.events} actionStatus={actionStatus} />
                {turn.state === "error" && <p className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">{turn.error}</p>}
                {turn.final && <AnswerText text={turn.final} />}
                {(files.length > 0 || pending.length > 0) && (
                  <div className="mt-2.5 space-y-2">
                    {files.map((file) => <FileCard key={file.fileId} file={file} onDownload={onDownload} />)}
                    {pending.map((item) => {
                      const status = actionStatus.get(item.actionId) ?? "awaiting_confirmation";
                      return status === "awaiting_confirmation" ? (
                        <div key={item.actionId} className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
                          <IconPause size={14} className="shrink-0 text-warning" />
                          <span className="min-w-0 flex-1">{item.preview.title} <span className="text-muted">Waiting for your confirmation.</span></span>
                          <Button size="sm" onClick={() => onReview(item.actionId)}>Review</Button>
                        </div>
                      ) : (
                        <div key={item.actionId} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                          <StatusChip status={status} />
                          <span className="text-muted">{item.preview.title.replace(/\?$/, "")}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="border-t border-border p-3">
        {!empty && (
          <div className="fade-x scroll-thin mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" disabled={busy} onClick={() => send(suggestion)} className="h-7 shrink-0 rounded-md border border-border bg-surface px-2.5 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50">
                {suggestion}
              </button>
            ))}
          </div>
        )}
        <form
          className="rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25"
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
            placeholder="Ask in plain English…"
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted/80 focus-visible:outline-none"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="pl-1 text-[11px] text-muted">Enter to send · Shift+Enter for a new line</span>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !draft.trim()} className="!h-7 !w-7 !px-0" aria-label={busy ? "Sending" : "Send"}>
              {busy ? <Spinner /> : <IconSend size={14} />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
