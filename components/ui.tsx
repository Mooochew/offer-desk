"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { actionStatus, parseMiniMarkdown, type StatusTone } from "@/lib/ui/format";
import { IconAlert, IconBan, IconCheck, IconChevron, IconClock, IconDots, IconPause, IconX } from "./icons";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-ink-fg hover:opacity-85 disabled:opacity-40",
  secondary: "border border-border bg-surface text-foreground shadow-[0_1px_0_rgba(0,0,0,0.03)] hover:border-border-strong hover:bg-surface-2 disabled:opacity-50",
  danger: "bg-critical text-ink-fg hover:opacity-90 disabled:opacity-50",
  ghost: "text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50",
};
const SIZES = { sm: "h-7 px-2.5 text-xs", md: "h-8 px-3 text-sm" } as const;

export function Button({ variant = "secondary", size = "md", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return <button type="button" className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-[background-color,border-color,opacity] disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`} {...props} />;
}

const TONES: Record<StatusTone, string> = {
  good: "bg-good-soft text-good",
  warning: "bg-warning-soft text-warning",
  serious: "bg-serious-soft text-serious",
  critical: "bg-critical-soft text-critical",
  neutral: "bg-surface-2 text-muted",
};

const STATUS_ICON: Record<string, (props: { size?: number }) => ReactNode> = {
  Done: IconCheck,
  "Needs confirm": IconPause,
  Running: IconDots,
  Started: IconDots,
  Cancelled: IconBan,
  Expired: IconClock,
  "Rejected call": IconAlert,
  Failed: IconX,
  Interrupted: IconAlert,
};

/** Status chip: icon + label + color (never color alone). */
export function StatusChip({ status, ageSeconds }: { status: string; ageSeconds?: number }) {
  const meta = actionStatus(status, ageSeconds);
  const Glyph = STATUS_ICON[meta.label];
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium ${TONES[meta.tone]}`}>
      {Glyph ? <Glyph size={12} /> : <span aria-hidden>{meta.icon}</span>}
      {meta.label}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone | "accent" | "outline" }) {
  const color = tone === "accent" ? "bg-accent-soft text-accent-strong" : tone === "outline" ? "border border-border text-muted" : TONES[tone];
  return <span className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium ${color}`}>{children}</span>;
}

export function Ref({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span className="inline-flex h-5 shrink-0 items-center rounded border border-border px-1 font-mono text-[11px] text-muted">{value}</span>;
}

export function EmptyState({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted">{icon}</span>}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

/** A disclosure summary with a rotating chevron (the browser marker is hidden in globals.css). */
export function Summary({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <summary className={`flex cursor-pointer select-none items-center gap-1.5 ${className}`}>
      <IconChevron size={12} className="chev shrink-0 text-muted transition-transform" />
      {children}
    </summary>
  );
}

/** A panel's top bar; every column uses the same height so the three headers line up. */
export function PanelHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex h-11 shrink-0 items-center gap-2 border-b border-border px-4 ${className}`}>{children}</div>;
}

/** Renders the agent's answer with a safe Markdown subset (React text nodes only, no HTML). */
export function AnswerText({ text }: { text: string }) {
  const blocks = parseMiniMarkdown(text);
  const items: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) items.push(<ul key={`ul${items.length}`} className="my-1.5 list-disc space-y-1 pl-4 marker:text-border-strong">{list}</ul>);
    list = [];
  };
  blocks.forEach((block, index) => {
    const content = block.spans.map((span, i) => (span.bold ? <strong key={i} className="font-semibold">{span.text}</strong> : <span key={i}>{span.text}</span>));
    if (block.kind === "li") list.push(<li key={index}>{content}</li>);
    else {
      flush();
      items.push(<p key={index} className="my-1.5 first:mt-0">{content}</p>);
    }
  });
  flush();
  return <div className="text-sm leading-relaxed text-foreground">{items}</div>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${className}`} />;
}
