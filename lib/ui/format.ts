/** Pure display helpers for the UI. No React, so they're unit-tested like the rest of lib/. */

export type StatusTone = "good" | "warning" | "serious" | "critical" | "neutral";

/** Action-log status → label, icon and tone. Status is never shown by color alone (icon + label). */
export const ACTION_STATUS: Record<string, { label: string; icon: string; tone: StatusTone }> = {
  executed: { label: "Done", icon: "✓", tone: "good" },
  awaiting_confirmation: { label: "Needs confirm", icon: "⏸", tone: "warning" },
  confirmed: { label: "Running", icon: "…", tone: "neutral" },
  proposed: { label: "Started", icon: "…", tone: "neutral" },
  rejected: { label: "Cancelled", icon: "⊘", tone: "neutral" },
  expired: { label: "Expired", icon: "⌛", tone: "neutral" },
  invalid: { label: "Rejected call", icon: "!", tone: "serious" },
  failed: { label: "Failed", icon: "✕", tone: "critical" },
};

export function actionStatus(status: string) {
  return ACTION_STATUS[status] ?? { label: status, icon: "•", tone: "neutral" as const };
}

/** "search_jobs" → "Search jobs". */
export function toolLabel(tool: string): string {
  const text = tool.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** "just now", "5 min ago", "3 h ago", "12 days ago". */
export function timeAgo(iso: string, now = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  const days = Math.round(seconds / 86_400);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export type SearchBreakdown = {
  considered: number;
  droppedRole: number;
  droppedSeniority: number;
  droppedInternship: number;
  droppedAge: number;
  droppedLocation: number;
  droppedDuplicates: number;
  remaining: number;
};
export type TriageBreakdown = { candidates: number; checked: number; notChecked: number; unread: number; droppedYears: number; droppedClearance: number; remaining: number };

/**
 * The funnel from "jobs considered" to "ranked", as steps with the count left after each, for the
 * breakdown bar. Counts come from code (search prefilter + triage), never the model.
 */
export function funnelSteps(search: SearchBreakdown | null, triage: TriageBreakdown | null): { label: string; count: number; removed?: string }[] {
  if (!search) return [];
  const steps: { label: string; count: number; removed?: string }[] = [{ label: "Engineering jobs", count: search.considered }];
  let left = search.considered;
  const cut = (label: string, removed: number, why: string) => {
    if (removed <= 0) return;
    left -= removed;
    steps.push({ label, count: left, removed: `−${removed} ${why}` });
  };
  cut("Matching role", search.droppedRole, "other roles");
  cut("Not senior", search.droppedSeniority, "senior titles");
  cut("Not internships", search.droppedInternship, "internships");
  cut("Recent", search.droppedAge, "too old");
  cut("Your locations", search.droppedLocation, "elsewhere");
  cut("No duplicates", search.droppedDuplicates, "duplicates");
  if (!triage) return steps;
  if (triage.notChecked > 0) steps.push({ label: "Requirements read", count: triage.checked, removed: `${triage.notChecked} not checked (limit)` });
  const afterRead = triage.checked - triage.unread;
  if (triage.unread > 0) steps.push({ label: "Readable", count: afterRead, removed: `${triage.unread} unread` });
  const afterYears = afterRead - triage.droppedYears;
  if (triage.droppedYears > 0) steps.push({ label: "Years OK", count: afterYears, removed: `−${triage.droppedYears} too many years` });
  if (triage.droppedClearance > 0) steps.push({ label: "No clearance needed", count: afterYears - triage.droppedClearance, removed: `−${triage.droppedClearance} clearance` });
  steps.push({ label: "Ranked for you", count: triage.remaining });
  return steps;
}

export const DROP_REASON: Record<string, string> = { years: "Needs more years than your limit", clearance: "Needs a security clearance" };

export function yearsLabel(years: number | null | undefined): string {
  if (years === null || years === undefined) return "years not stated";
  if (years === 0) return "0 years";
  return `${years}+ yr${years === 1 ? "" : "s"}`;
}

export const CLEARANCE_LABEL: Record<string, string> = { yes: "active clearance", ability_to_obtain: "clearance eligibility", no: "no clearance", unknown: "" };

/** A tiny, safe Markdown subset for chat answers: paragraphs, "- " bullets, **bold**. No HTML. */
export type MdBlock = { kind: "p" | "li"; spans: { text: string; bold: boolean }[] };

export function parseMiniMarkdown(text: string): MdBlock[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/.exec(line);
      const body = bullet ? line.slice(bullet[0].length) : line;
      const spans = body.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));
      return { kind: bullet ? ("li" as const) : ("p" as const), spans };
    });
}
