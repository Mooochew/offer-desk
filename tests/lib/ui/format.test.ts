import { describe, expect, it } from "vitest";
import { computeFunnel } from "@/lib/agent/funnel";
import { actionStatus, formatDuration, funnelSteps, parseMiniMarkdown, timeAgo, toolLabel, yearsLabel } from "@/lib/ui/format";

describe("UI format helpers", () => {
  it("labels every action status with an icon, never color alone", () => {
    for (const status of ["executed", "awaiting_confirmation", "confirmed", "proposed", "rejected", "expired", "invalid", "failed"]) {
      const meta = actionStatus(status);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
    }
    expect(actionStatus("weird")).toEqual({ label: "weird", icon: "•", tone: "neutral" });
    expect(actionStatus("failed").tone).toBe("critical");
    // Phase 5 review S6: a row cut off mid-call shows as interrupted, not "Running" forever.
    expect(actionStatus("confirmed", 30).label).toBe("Running");
    expect(actionStatus("confirmed", 301)).toMatchObject({ label: "Interrupted", tone: "serious" });
    expect(actionStatus("proposed", 9999).label).toBe("Interrupted");
    expect(actionStatus("executed", 9999).label).toBe("Done");
  });

  it("formats tool names, durations, ages and years", () => {
    expect(toolLabel("search_jobs")).toBe("Search jobs");
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(1850)).toBe("1.9 s");
    expect(formatDuration(null)).toBe("");
    const now = new Date("2026-11-10T20:00:00Z");
    expect(timeAgo("2026-11-10T19:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-11-10T19:30:00Z", now)).toBe("30 min ago");
    expect(timeAgo("2026-11-10T15:00:00Z", now)).toBe("5 h ago");
    expect(timeAgo("2026-11-09T20:00:00Z", now)).toBe("1 day ago");
    expect(timeAgo("2026-10-20T20:00:00Z", now)).toBe("21 days ago");
    expect(yearsLabel(null)).toBe("years not stated");
    expect(yearsLabel(0)).toBe("0 years");
    expect(yearsLabel(1)).toBe("1+ yr");
    expect(yearsLabel(3)).toBe("3+ yrs");
  });

  it("builds the funnel steps from code counts, skipping steps that removed nothing", () => {
    const search = { considered: 7917, droppedRole: 6155, droppedSeniority: 975, droppedInternship: 83, droppedAge: 559, droppedLocation: 117, droppedDuplicates: 0, remaining: 28 };
    const triage = { candidates: 28, checked: 25, notChecked: 3, unread: 1, droppedYears: 5, droppedClearance: 1, remaining: 18 };
    const steps = funnelSteps(search, triage);
    expect(steps.map((step) => [step.label, step.count])).toEqual([
      ["All listings searched", 7917],
      ["Matching role", 1762],
      ["Not senior", 787],
      ["Not internships", 704],
      ["Recent", 145],
      ["Your locations", 28],
      ["Requirements read", 25],
      ["Readable", 24],
      ["Years OK", 19],
      ["No clearance needed", 18],
      ["Ranked for you", 18],
    ]);
    expect(steps.at(-2)!.count).toBe(triage.remaining); // the chain adds up
    expect(funnelSteps(search, null).at(-1)).toEqual({ label: "Your locations", count: 28, removed: "−117 elsewhere" });
    expect(funnelSteps(null, null)).toEqual([]);
  });

  it("parses a safe Markdown subset (no HTML ever)", () => {
    expect(parseMiniMarkdown("Found **9 roles**.\n\n- **J1 — Acme**, Engineer\n2. Second <script>")).toEqual([
      { kind: "p", spans: [{ text: "Found ", bold: false }, { text: "9 roles", bold: true }, { text: ".", bold: false }] },
      { kind: "li", spans: [{ text: "J1 — Acme", bold: true }, { text: ", Engineer", bold: false }] },
      { kind: "li", spans: [{ text: "Second <script>", bold: false }] },
    ]);
  });
});

describe("computeFunnel", () => {
  it("counts the in-range cohort and the all-time pipeline", () => {
    const now = new Date("2026-11-10T20:00:00Z");
    const app = (stage: string, daysAgo: number, applied: boolean) => ({
      id: crypto.randomUUID(), postingId: `p${daysAgo}`, stage: stage as never, notes: "", nextStepAt: null,
      appliedAt: applied ? now.toISOString() : null,
      createdAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), updatedAt: now.toISOString(),
    });
    const stats = computeFunnel([app("saved", 1, false), app("archived", 2, true), app("offer", 3, true), app("applied", 45, true)], () => "lever", now, 30);
    expect(stats.funnel).toEqual({ added: 3, applied: 2, responded: 1, interviewed: 1, offers: 1 });
    expect(stats.responseRate).toBe(50);
    expect(stats.pipelineNow.active).toBe(3);
    expect(stats.bySource).toEqual({ lever: 4 });
    expect(computeFunnel([], () => "x", now).responseRate).toBeNull();
  });
});
