import { describe, expect, it } from "vitest";
import { buildChecklist } from "@/lib/files/checklist";
import { csvCell, toCsv } from "@/lib/files/csv";
import { buildInvite, foldLine, icsEscape, icsUtc } from "@/lib/files/ics";
import { formatLocal, localDate, localWeekday, validTimezone, zonedTimeToUtc } from "@/lib/files/time";

describe("CSV", () => {
  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    expect(csvCell('Acme, "Inc"')).toBe('"Acme, ""Inc"""');
    expect(csvCell("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
  });

  it("neutralizes spreadsheet formulas from third-party text (CSV injection)", () => {
    for (const hostile of ["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd"]) {
      expect(csvCell(hostile).replace(/^"/, "")).toMatch(/^'/);
    }
    expect(csvCell("Backend Engineer")).toBe("Backend Engineer");
  });

  it("builds a header plus rows with CRLF line ends", () => {
    expect(toCsv(["a", "b"], [["1", null]])).toBe("a,b\r\n1,\r\n");
  });
});

describe("time zones", () => {
  it("converts a Pacific wall-clock time to UTC in standard and daylight time", () => {
    expect(zonedTimeToUtc("2026-11-12T14:00", "America/Los_Angeles")?.toISOString()).toBe("2026-11-12T22:00:00.000Z"); // PST, UTC-8
    expect(zonedTimeToUtc("2026-07-09T14:00", "America/Los_Angeles")?.toISOString()).toBe("2026-07-09T21:00:00.000Z"); // PDT, UTC-7
    expect(zonedTimeToUtc("2026-11-12T14:00", "Asia/Kolkata")?.toISOString()).toBe("2026-11-12T08:30:00.000Z");
    expect(zonedTimeToUtc("2026-11-12T14:00", "UTC")?.toISOString()).toBe("2026-11-12T14:00:00.000Z");
  });

  it("handles the day after a DST change (offset re-checked at the result)", () => {
    // US DST ended 2026-11-01 at 2:00; 9:00 that day is PST.
    expect(zonedTimeToUtc("2026-11-01T09:00", "America/New_York")?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(zonedTimeToUtc("2026-03-08T09:00", "America/New_York")?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("rejects malformed and impossible times", () => {
    for (const bad of ["2026-02-30T10:00", "2026-13-01T10:00", "2026-11-12T25:00", "Thursday at 2", "2026-11-12"]) {
      expect(zonedTimeToUtc(bad, "America/Los_Angeles")).toBeNull();
    }
  });

  it("validates IANA timezones", () => {
    expect(validTimezone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(validTimezone("Mars/Olympus_Mons")).toBeNull();
    expect(validTimezone("")).toBeNull();
    expect(validTimezone("x".repeat(65))).toBeNull();
  });

  it("formats local dates, weekdays and times", () => {
    const instant = new Date("2026-11-11T06:30:00Z"); // still Nov 10 in Los Angeles
    expect(localDate(instant, "America/Los_Angeles")).toBe("2026-11-10");
    expect(localWeekday(instant, "America/Los_Angeles")).toBe("Tuesday");
    expect(formatLocal(new Date("2026-11-12T22:00:00Z"), "America/Los_Angeles")).toBe("Thu, Nov 12, 2:00 PM PST");
  });
});

describe("ICS", () => {
  it("escapes text values", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const folded = foldLine(`SUMMARY:${"é".repeat(60)}`);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((line, index) => (index ? line.slice(1) : line)).join("")).toBe(`SUMMARY:${"é".repeat(60)}`);
  });

  it("writes a UTC VEVENT with the right start, end and escaped fields", () => {
    const ics = buildInvite({
      uid: "abc@offer-desk",
      title: "Interview: Engineer, Backend",
      start: new Date("2026-11-12T22:00:00Z"),
      durationMinutes: 45,
      description: "Line 1\nLine 2",
      url: "https://jobs.example.com/1",
      location: "Zoom",
      createdAt: new Date("2026-11-10T20:00:00Z"),
    });
    expect(ics).toContain("DTSTART:20261112T220000Z\r\n");
    expect(ics).toContain("DTEND:20261112T224500Z\r\n");
    expect(ics).toContain("DTSTAMP:20261110T200000Z\r\n");
    expect(ics).toContain("SUMMARY:Interview: Engineer\\, Backend\r\n");
    expect(ics).toContain("DESCRIPTION:Line 1\\nLine 2\r\n");
    expect(ics).toContain("LOCATION:Zoom\r\n");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(icsUtc(new Date("2026-01-02T03:04:05.678Z"))).toBe("20260102T030405Z");
  });
});

describe("apply checklist", () => {
  const item = { ref: "J1", title: "Backend Engineer", company: "Acme", location: "Irvine, CA", url: "https://jobs.example.com/1", score: 72, why: "Matches Go", stage: "saved" };

  it("lists each job with its facts, link and steps", () => {
    const markdown = buildChecklist([item], "2026-11-10", 2);
    expect(markdown).toContain("# Apply checklist");
    expect(markdown).toContain("version 2 · 1 job");
    expect(markdown).toContain("## Backend Engineer · Acme (J1)");
    expect(markdown).toContain("Location: Irvine, CA · Score: 72 · Stage: saved");
    expect(markdown).toContain("- [ ] Read the posting: [apply link](https://jobs.example.com/1)");
  });

  it("escapes Markdown in third-party text and drops non-http links", () => {
    const markdown = buildChecklist([{ ...item, title: "Eng](javascript:alert(1)) # <b>", url: "javascript:alert(1)", score: null, why: null, location: null, stage: null }], "2026-11-10", 1);
    // Escaped brackets can't form a link; the only real link syntax would be an unescaped "](".
    expect(markdown).toContain("## Eng\\](javascript:alert(1)) \\# \\<b\\>");
    expect(markdown).not.toMatch(/(?<!\\)\]\(javascript/);
    expect(markdown).toContain("- [ ] Read the posting\n");
  });
});
