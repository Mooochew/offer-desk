"use client";

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import type { TurnEvent } from "@/lib/agent/loop";
import type { SessionState } from "@/lib/agent/session-state";
import type { Preview } from "@/lib/agent/tools/types";
import { ActionLog } from "./action-log";
import { api } from "./api";
import { ChatPanel, type ChatTurn } from "./chat-panel";
import { ConfirmDialog, minutesUntil, type PendingAction } from "./confirm-dialog";
import { FunnelTab, PipelineTab } from "./pipeline-view";
import { ResultsTab, type SourceStatus } from "./results-view";
import { FileIcon, IconCheck, IconChevron, IconDownload, IconInfo, IconLayers, IconPause, IconUser, IconX, Logo } from "./icons";
import { Badge, Button, PanelHeader, Spinner, Summary } from "./ui";

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

  const TABS = ["results", "pipeline", "funnel"] as const;
  // Arrow keys move between tabs (WAI-ARIA tabs pattern), review N3.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  const active = state.pipeline.filter((item) => item.application.stage !== "archived").length;

  const board = (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader className="!py-0">
        <div className="flex h-full items-stretch gap-5" role="tablist" aria-label="Board">
          {TABS.map((name) => (
            <button
              key={name}
              id={`tab-${name}`}
              role="tab"
              type="button"
              aria-selected={tab === name}
              aria-controls="board-panel"
              tabIndex={tab === name ? 0 : -1}
              onClick={() => setTab(name)}
              onKeyDown={onTabKey}
              className={`-mb-px flex items-center gap-1.5 border-b-2 text-sm capitalize transition-colors ${tab === name ? "border-foreground font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {name}
              {name === "pipeline" && active > 0 && <span className="rounded bg-surface-2 px-1.5 text-[11px] font-medium tabular-nums text-muted">{active}</span>}
            </button>
          ))}
        </div>
      </PanelHeader>
      <div id="board-panel" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 lg:p-5" role="tabpanel" aria-labelledby={`tab-${tab}`}>
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
      <PanelHeader>
        <h2 className="text-sm font-medium">Action log</h2>
        {awaiting > 0 && <Badge tone="warning"><IconPause size={11} /> {awaiting} to confirm</Badge>}
        {state.actions.length > 0 && <span className="ml-auto text-xs tabular-nums text-muted">{state.actions.length} calls</span>}
      </PanelHeader>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {state.files.length > 0 && (
          <details className="border-b border-border px-4 py-3" open>
            <Summary className="text-xs font-medium text-muted">Your files ({state.files.length})</Summary>
            <ul className="mt-2 space-y-0.5">
              {state.files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 py-0.5 text-xs">
                  <span className="text-muted"><FileIcon kind={file.kind} size={14} /></span>
                  <span className="min-w-0 flex-1 truncate" title={file.filename}>{file.filename}</span>
                  <Button variant="ghost" size="sm" className="!h-6 !px-1.5" onClick={() => download(file.id)}>
                    <IconDownload size={13} /> Download
                  </Button>
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
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <Logo size={26} />
        <div className="min-w-0">
          <h1 className="whitespace-nowrap text-[15px] font-semibold leading-tight tracking-tight">Offer Desk</h1>
          <p className="hidden truncate text-xs text-muted lg:block">Finds real entry-level roles, reads their requirements, and tracks your applications.</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span className="mr-1 hidden text-xs text-muted xl:inline">Demo</span>
          <Button size="sm" onClick={() => demo("profile")} disabled={busy} aria-label="Load demo profile"><IconUser size={13} /><span className="hidden sm:inline">Load demo profile</span><span className="sm:hidden">Demo</span></Button>
          <Button size="sm" onClick={() => demo("seed")} disabled={busy} aria-label="Seed sample pipeline"><IconLayers size={13} /><span className="hidden sm:inline">Seed sample pipeline</span><span className="sm:hidden">Seed</span></Button>
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
          <details className="relative">
            <summary className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${profile ? "bg-good" : "bg-border-strong"}`} aria-hidden />
              Profile
              <IconChevron size={11} className="chev rotate-90 transition-transform" />
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-border bg-surface p-4 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
              {profile ? (
                <dl className="space-y-2.5">
                  {[
                    ["Skills", profile.skills.join(", ") || "none"],
                    ["Places", `${profile.places.join(", ") || "anywhere"}${profile.remoteOk ? " + US remote" : ""}`],
                    ["Max years", String(profile.maxYears)],
                    ["Hide clearance-eligible jobs", profile.excludeClearanceEligible ? "yes" : "no"],
                  ].map(([label, value]) => (
                    <div key={label}><dt className="text-xs text-muted">{label}</dt><dd>{value}</dd></div>
                  ))}
                  <p className="border-t border-border pt-2.5 text-xs text-muted">Change it in chat: “add Rust to my skills”, “hide anything over 1 year”.</p>
                </dl>
              ) : (
                <p className="text-muted">No profile yet. Click <b className="text-foreground">Load demo profile</b>, or tell the agent your skills and where you want to work.</p>
              )}
            </div>
          </details>
        </div>
      </header>
      {sessionError && <p className="border-b border-critical/30 bg-critical-soft px-4 py-1.5 text-xs text-critical">Session problem: {sessionError} <button type="button" className="underline" onClick={() => void refresh()}>Retry</button></p>}

      <nav className="flex border-b border-border bg-surface md:hidden" aria-label="Panels">
        {(["chat", "board", "log"] as const).map((name) => (
          <button key={name} type="button" onClick={() => setMobile(name)} aria-pressed={mobile === name} className={`-mb-px flex-1 border-b-2 py-2.5 text-sm capitalize ${mobile === name ? "border-foreground font-medium" : "border-transparent text-muted"}`}>
            {name === "board" ? tab : name}
          </button>
        ))}
      </nav>

      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)_minmax(280px,0.85fr)] xl:grid-cols-[400px_minmax(0,1fr)_340px]">
        <section aria-label="Chat" className={`min-h-0 border-border bg-surface md:block md:border-r ${mobile === "chat" ? "block" : "hidden"}`}>
          <ChatPanel history={history ?? []} turns={turns} busy={busy} onSend={send} onDownload={download} onReview={review} actionStatus={new Map(state.actions.map((action) => [action.id, action.status]))} />
        </section>
        <section aria-label="Board" className={`min-h-0 md:block ${mobile === "board" ? "block" : "hidden"}`}>{board}</section>
        <section aria-label="Action log" className={`min-h-0 border-border bg-surface md:block md:border-l ${mobile === "log" ? "block" : "hidden"}`}>{log}</section>
      </main>

      {pending && <ConfirmDialog action={pending} onConfirm={() => decide("confirm")} onCancel={() => decide("reject")} onClose={() => setPending(null)} />}

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.10)]">
            <span className={`mt-0.5 shrink-0 ${item.tone === "good" ? "text-good" : item.tone === "critical" ? "text-critical" : "text-muted"}`}>
              {item.tone === "good" ? <IconCheck size={15} /> : item.tone === "critical" ? <IconX size={15} /> : <IconInfo size={15} />}
            </span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
