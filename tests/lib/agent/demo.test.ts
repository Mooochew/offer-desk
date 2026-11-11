import { describe, expect, it } from "vitest";
import { demoApplicationRows, demoStoredProfile } from "@/lib/agent/demo";
import { boardJob } from "../search/fakes";

const NOW = new Date("2026-11-10T20:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("demo data", () => {
  it("loads the bundled demo profile", () => {
    expect(demoStoredProfile()).toMatchObject({ places: ["socal"], remoteOk: true, maxYears: 2, excludeClearanceEligible: false, skills: expect.arrayContaining(["TypeScript", "PostgreSQL"]) });
  });

  it("seeds one application per company, with some untouched for 3+ weeks to archive in the demo", () => {
    const jobs = ["Zed", "Acme", "Acme", "Beta", "Cora", "Dyna", "Echo", "Fox", "Gaia", "Hex"].map((company, index) => boardJob({ company, sourceId: `s${index}` }));
    const rows = demoApplicationRows(jobs, "u1", NOW);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((row) => row.posting_id)).size).toBe(8);
    expect(rows.every((row) => row.user_id === "u1")).toBe(true);
    const stale = rows.filter((row) => NOW.getTime() - Date.parse(row.updated_at) >= 21 * DAY);
    expect(stale.length).toBe(4);
    expect(rows.every((row) => row.created_at <= row.updated_at)).toBe(true);
    expect(rows.filter((row) => row.stage === "applied").every((row) => row.applied_at)).toBe(true);
    expect(demoApplicationRows(jobs, "u1", NOW)).toEqual(rows); // deterministic
  });
});
