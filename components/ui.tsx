"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { actionStatus, parseMiniMarkdown, type StatusTone } from "@/lib/ui/format";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong disabled:opacity-50",
  secondary: "border border-border bg-surface hover:bg-surface-2 disabled:opacity-50",
  danger: "bg-critical text-white hover:opacity-90 disabled:opacity-50",
  ghost: "text-muted hover:bg-surface-2 hover:text-foreground",
};

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`} {...props} />;
}

const TONES: Record<StatusTone, string> = {
  good: "bg-good-soft text-good",
  warning: "bg-warning-soft text-warning",
  serious: "bg-serious-soft text-serious",
  critical: "bg-critical-soft text-critical",
  neutral: "bg-surface-2 text-muted",
};

/** Status chip: icon + label + color (never color alone). */
export function StatusChip({ status, ageSeconds }: { status: string; ageSeconds?: number }) {
  const meta = actionStatus(status, ageSeconds);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONES[meta.tone]}`}>
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone | "accent" }) {
  const color = tone === "accent" ? "bg-accent-soft text-accent-strong" : TONES[tone];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>{children}</span>;
}

export function Ref({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">{value}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Renders the agent's answer with a safe Markdown subset (React text nodes only, no HTML). */
export function AnswerText({ text }: { text: string }) {
  const blocks = parseMiniMarkdown(text);
  const items: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) items.push(<ul key={`ul${items.length}`} className="my-1 list-disc space-y-0.5 pl-5">{list}</ul>);
    list = [];
  };
  blocks.forEach((block, index) => {
    const content = block.spans.map((span, i) => (span.bold ? <strong key={i}>{span.text}</strong> : <span key={i}>{span.text}</span>));
    if (block.kind === "li") list.push(<li key={index}>{content}</li>);
    else {
      flush();
      items.push(<p key={index} className="my-1">{content}</p>);
    }
  });
  flush();
  return <div className="text-sm leading-relaxed">{items}</div>;
}

export function Spinner() {
  return <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
