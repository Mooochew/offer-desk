"use client";

import { useCallback, useEffect, useState } from "react";
import type { TurnEvent } from "@/lib/agent/loop";
import type { SessionState } from "@/lib/agent/session-state";
import type { Preview } from "@/lib/agent/tools/types";
import { ActionLog } from "./action-log";
import { api } from "./api";
import { ChatPanel, type ChatTurn } from "./chat-panel";
import { ConfirmDialog, minutesUntil, type PendingAction } from "./confirm-dialog";
import { FunnelTab, PipelineTab } from "./pipeline-view";
import { ResultsTab, type SourceStatus } from "./results-view";
import { Button, Spinner } from "./ui";

type Toast = { id: number; tone: "good" | "critical" | "neutral"; text: string };
type Tab = "results" | "pipeline" | "funnel";
type MobilePanel = "chat" | "board" | "log";

const EMPTY: SessionState = { profile: null, pipeline: [], files: [], actions: [], messages: [], results: null };

/** Which tab a turn's output belongs on, so the board follows what the agent just did. */
function tabFor(events: TurnEvent[]): Tab | null {
  const kinds = events.filter((event) => event.type === "ui_payload").map((event) => (event as { payload: { kind: string } }).payload.kind);
  if (kinds.includes("funnel")) return "funnel";
  if (kinds.includes("triage") || kinds.includes("search")) return "results";
  if (kinds.some((kind) => kind === "pipeline" || kind === "pipeline_change")) return "pipeline";
  return null;
}

export function OfferDesk() {
  const [state, setState] = useState<SessionState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("results");
  const [mobile, setMobile] = useState<MobilePanel>("chat");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sources, setSources] = useState<{ sources: SourceStatus[]; usedSnapshot: boolean }>({ sources: [], usedSnapshot: false });
  // Chat history is captured once, on the first load; later turns live in `turns` (review S1).
  const [history, setHistory] = useState<SessionState["messages"] | null>(null);
  // The funnel range follows the last range the agent used ("this week" = 7), review S2.
  const [funnelRange, setFunnelRange] = useState(30);
  // When the state was last read; render stays pure (no Date.now() during render).
  const [loadedAt, setLoadedAt] = useState(0);

  const toast = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { id, tone, text }]);
    setTimeout(() => setToasts((all) => all.filter((item) => item.id !== id)), 6000);
  }, []);

  const apply = useCallback((result: Awaited<ReturnType<typeof api.state>> | Error) => {
    if (result instanceof Error || !result.body.ok) {
      setSessionError(result instanceof Error ? result.message : (result.body as { error: string }).error);
    } else {
      const { ok: _ok, ...next } = result.body;
      void _ok;
      setState(next);
      setHistory((current) => current ?? next.messages);
      setLoadedAt(Date.now());
      setSessionError(null);
    }
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => apply(await api.state().catch((error: Error) => error)), [apply]);

  useEffect(() => {
    let live = true;
    api
      .state()
      .catch((error: Error) => error)
      .then((result) => live && apply(result));
    return () => {
      live = false;
    };
  }, [apply]);

  const send = async (message: string) => {
    const id = crypto.randomUUID();
    setTurns((all) => [...all, { id, message, state: "running", events: [], final: "" }]);
    setBusy(true);
    try {
      const { status, body } = await api.turn(message);
      if (!body.ok) {
        const text = status === 429 ? `${body.error}${body.retryAfterSeconds ? ` (about ${Math.ceil(body.retryAfterSeconds / 60)} min)` : ""}` : body.error;
        setTurns((all) => all.map((turn) => (turn.id === id ? { ...turn, state: "error", error: text } : turn)));
        toast("critical", text);
        return;
      }
      setTurns((all) => all.map((turn) => (turn.id === id ? { ...turn, state: "done", events: body.events, final: body.final } : turn)));
      const status_ = body.events.find((event) => event.type === "source_status") as { sources: SourceStatus[]; usedSnapshot: boolean } | undefined;
      if (status_) setSources({ sources: status_.sources, usedSnapshot: status_.usedSnapshot });
      const next = tabFor(body.events);
      if (next) setTab(next);
      const funnel = body.events.find((event) => event.type === "ui_payload" && event.payload.kind === "funnel") as { payload: { rangeDays?: number } } | undefined;
      if (funnel?.payload.rangeDays) setFunnelRange(funnel.payload.rangeDays);
      const proposal = body.events.find((event) => event.type === "pending_action") as Extract<TurnEvent, { type: "pending_action" }> | undefined;
      if (proposal) setPending({ actionId: proposal.actionId, tool: proposal.tool, preview: proposal.preview, minutesLeft: minutesUntil(proposal.expiresAt) });
      const failure = body.events.find((event) => event.type === "error") as Extract<TurnEvent, { type: "error" }> | undefined;
      if (failure) toast("critical", failure.message);
    } catch (error) {
      const text = `Couldn't reach the server: ${(error as Error).message}`;
      setTurns((all) => all.map((turn) => (turn.id === id ? { ...turn, state: "error", error: text } : turn)));
      toast("critical", text);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const review = (actionId: string) => {
    const action = state.actions.find((item) => item.id === actionId);
    if (action && action.status === "awaiting_confirmation" && action.preview) {
      setPending({ actionId, tool: action.tool, preview: action.preview as Preview, minutesLeft: minutesUntil(action.expiresAt) });
      return;
    }
    for (const turn of turns) {
      const event = turn.events.find((item) => item.type === "pending_action" && item.actionId === actionId) as Extract<TurnEvent, { type: "pending_action" }> | undefined;
      if (event) return setPending({ actionId, tool: event.tool, preview: event.preview, minutesLeft: minutesUntil(event.expiresAt) });
    }
    toast("neutral", "That action was already handled.");
  };

  // Every button that calls the server reports network failures instead of failing silently (review S7).
  const networkError = (error: unknown) => toast("critical", `Couldn't reach the server: ${(error as Error).message}`);

  const decide = async (kind: "confirm" | "reject") => {
    if (!pending) return;
    try {
      const { body } = kind === "confirm" ? await api.confirm(pending.actionId) : await api.reject(pending.actionId);
      if (body.ok) toast(kind === "confirm" ? "good" : "neutral", kind === "confirm" ? `Done: ${(body as { summary?: string }).summary ?? "confirmed"}.` : "Cancelled. Nothing changed.");
      else toast("critical", body.error ?? "That didn't work.");
      setPending(null);
      if (kind === "confirm" && body.ok) setTab("pipeline");
    } catch (error) {
      networkError(error); // the dialog stays open so the user can try again
    }
    await refresh();
  };

  const demo = async (kind: "profile" | "seed") => {
    setBusy(true); // no double clicks while it runs
    try {
      const { body } = kind === "profile" ? await api.demoProfile() : await api.demoSeed();
      if (!body.ok) toast("critical", body.error ?? "That didn't work.");
      else if (kind === "profile") toast("good", "Demo profile loaded: new-grad CS, SoCal or remote, TypeScript/Python/Postgres, up to 2 years.");
      else toast("good", (body as { created?: number }).created ? `Added ${(body as { created?: number }).created} sample applications (some untouched for weeks).` : "The sample pipeline is already there.");
      if (kind === "seed") setTab("pipeline");
    } catch (error) {
      networkError(error);
    } finally {
      setBusy(false);
    }
    await refresh();
  };

  const download = async (fileId: string) => {
    try {
      const { body } = await api.fileUrl(fileId);
      if (!body.ok || !body.url) return toast("critical", body.error ?? "Couldn't get the download link.");
      // A link click downloads (the signed URL is served as an attachment) without leaving the page.
      const link = document.createElement("a");
      link.href = body.url;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      networkError(error);
    }
  };

  const profile = state.profile;
  const awaiting = state.actions.filter((action) => action.status === "awaiting_confirmation").length;

  const board = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-border px-3 pt-2" role="tablist" aria-label="Board">
        {(["results", "pipeline", "funnel"] as const).map((name) => (
          <button key={name} role="tab" type="button" aria-selected={tab === name} onClick={() => setTab(name)} className={`rounded-t-md px-3 py-1.5 text-sm font-medium capitalize ${tab === name ? "border-b-2 border-accent text-foreground" : "text-muted hover:text-foreground"}`}>
            {name}
            {name === "pipeline" && state.pipeline.length > 0 && <span className="ml-1 text-xs text-muted">{state.pipeline.filter((item) => item.application.stage !== "archived").length}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading your session…</p>
        ) : tab === "results" ? (
          <ResultsTab results={state.results} sources={sources.sources} usedSnapshot={sources.usedSnapshot} />
        ) : tab === "pipeline" ? (
          <PipelineTab pipeline={state.pipeline} />
        ) : (
          <FunnelTab pipeline={state.pipeline} range={funnelRange} onRange={setFunnelRange} />
        )}
      </div>
    </div>
  );

  const log = (
    <div className="flex h-full min-h-0 flex-col">
      <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold">
        Action log {awaiting > 0 && <span className="ml-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning">⏸ {awaiting} to confirm</span>}
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.files.length > 0 && (
          <details className="mb-3 rounded-lg border border-border bg-surface p-2" open>
            <summary className="cursor-pointer text-sm font-medium">Your files ({state.files.length})</summary>
            <ul className="mt-2 space-y-1.5">
              {state.files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 text-xs">
                  <span aria-hidden>{file.kind === "ics" ? "\u{1F4C5}" : file.kind === "csv" ? "\u{1F4CA}" : "\u{1F4DD}"}</span>
                  <span className="min-w-0 flex-1 truncate" title={file.filename}>{file.ref ? `${file.ref} \u00b7 ` : ""}{file.filename}</span>
                  <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => download(file.id)}>Download</Button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <ActionLog actions={state.actions} onReview={review} now={loadedAt} />
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2.5">
        <div>
          <h1 className="text-lg font-semibold leading-tight">Offer Desk</h1>
          <p className="hidden text-xs text-muted sm:block">Finds real entry-level roles, reads their requirements, and tracks your applications.</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Button onClick={() => demo("profile")} disabled={busy} className="!px-2 text-xs sm:!px-3 sm:text-sm">Load demo profile</Button>
          <Button onClick={() => demo("seed")} disabled={busy} className="!px-2 text-xs sm:!px-3 sm:text-sm">Seed sample pipeline</Button>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md border border-border px-2 py-1.5 text-xs sm:px-3 sm:text-sm">Profile ▾</summary>
            <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg">
              {profile ? (
                <dl className="space-y-1">
                  <div><dt className="inline text-muted">Skills: </dt><dd className="inline">{profile.skills.join(", ") || "none"}</dd></div>
                  <div><dt className="inline text-muted">Places: </dt><dd className="inline">{profile.places.join(", ") || "anywhere"}{profile.remoteOk ? " + US remote" : ""}</dd></div>
                  <div><dt className="inline text-muted">Max years: </dt><dd className="inline">{profile.maxYears}</dd></div>
                  <div><dt className="inline text-muted">Hide clearance-eligible jobs: </dt><dd className="inline">{profile.excludeClearanceEligible ? "yes" : "no"}</dd></div>
                  <p className="pt-1 text-xs text-muted">Change it in chat: “add Rust to my skills”, “hide anything over 1 year”.</p>
                </dl>
              ) : (
                <p className="text-muted">No profile yet. Click <b>Load demo profile</b>, or tell the agent your skills and where you want to work.</p>
              )}
            </div>
          </details>
        </div>
        {sessionError && <p className="w-full text-xs text-critical">Session problem: {sessionError} <button type="button" className="underline" onClick={() => void refresh()}>Retry</button></p>}
      </header>

      <nav className="flex border-b border-border bg-surface md:hidden" aria-label="Panels">
        {(["chat", "board", "log"] as const).map((name) => (
          <button key={name} type="button" onClick={() => setMobile(name)} aria-pressed={mobile === name} className={`flex-1 py-2 text-sm font-medium capitalize ${mobile === name ? "border-b-2 border-accent" : "text-muted"}`}>
            {name === "board" ? tab : name}
          </button>
        ))}
      </nav>

      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(300px,1fr)_minmax(0,2fr)_minmax(260px,0.9fr)]">
        <section aria-label="Chat" className={`min-h-0 border-border bg-surface md:block md:border-r ${mobile === "chat" ? "block" : "hidden"}`}>
          <ChatPanel history={history ?? []} turns={turns} busy={busy} onSend={send} onDownload={download} onReview={review} actionStatus={new Map(state.actions.map((action) => [action.id, action.status]))} />
        </section>
        <section aria-label="Board" className={`min-h-0 md:block ${mobile === "board" ? "block" : "hidden"}`}>{board}</section>
        <section aria-label="Action log" className={`min-h-0 border-border bg-surface md:block md:border-l ${mobile === "log" ? "block" : "hidden"}`}>{log}</section>
      </main>

      {pending && <ConfirmDialog action={pending} onConfirm={() => decide("confirm")} onCancel={() => decide("reject")} onClose={() => setPending(null)} />}

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`pointer-events-auto rounded-lg border p-3 text-sm shadow-lg ${item.tone === "good" ? "border-good bg-good-soft" : item.tone === "critical" ? "border-critical bg-critical-soft" : "border-border bg-surface"}`}>
            <span aria-hidden>{item.tone === "good" ? "✓ " : item.tone === "critical" ? "✕ " : "ℹ "}</span>
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}
