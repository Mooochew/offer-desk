import { describe, expect, it } from "vitest";
import { hasNewGradSignal, isInternship, isSeniorTitle, rolesInQuery, titleMatchesRoles } from "@/lib/search/title";

describe("rolesInQuery", () => {
  it("finds every role the user asked for", () => {
    expect(rolesInQuery("entry-level backend and full-stack roles")).toEqual(["backend", "fullstack"]);
    expect(rolesInQuery("iOS or Android")).toEqual(["mobile"]);
    expect(rolesInQuery("ML / AI engineer")).toEqual(["ml"]);
  });

  // Phase 2 review: "Capital One" used to parse as a backend ("api") query.
  it("needs whole words for api/server", () => {
    expect(rolesInQuery("Capital One software engineer")).toEqual([]);
    expect(rolesInQuery("API and server work")).toEqual(["backend"]);
  });

  it("returns no roles for a general query", () => {
    expect(rolesInQuery("software engineer jobs")).toEqual([]);
  });
});

describe("titleMatchesRoles", () => {
  const backendOrFullstack = ["backend", "fullstack"];

  it.each([
    ["Software Engineer, Backend", true],
    ["Full Stack Software Engineer, Internal Platforms", true],
    ["Software Engineer", true], // generic software title fits a generalist search
    ["iOS Engineer", false], // a different specialty
    ["Machine Learning Engineer", false],
  ])("backend/full-stack search: %s → %s", (title, expected) => {
    expect(titleMatchesRoles(title, backendOrFullstack)).toBe(expected);
  });

  // Regressions from the first live run (Phase 2): these matched a backend/full-stack search.
  it.each([
    "Battery Systems Engineer",
    "RF Mission Systems Engineer",
    "Curriculum Developer",
    "Operations Analyst, Hardware Platform Operations",
  ])("rejects non-software role: %s", (title) => {
    expect(titleMatchesRoles(title, backendOrFullstack)).toBe(false);
    expect(titleMatchesRoles(title, [])).toBe(false);
  });

  it("with no roles requested, accepts software roles of any specialty", () => {
    expect(titleMatchesRoles("Android Engineer", [])).toBe(true);
    expect(titleMatchesRoles("Data Engineer", [])).toBe(true);
    expect(titleMatchesRoles("Firmware Engineer", [])).toBe(false);
  });

  it("matches the requested specialty", () => {
    expect(titleMatchesRoles("Machine Learning Engineer", ["ml"])).toBe(true);
    expect(titleMatchesRoles("Firmware Engineer", ["embedded"])).toBe(true);
  });
});

describe("seniority, internships, new-grad signals", () => {
  it.each([
    "Senior Software Engineer",
    "Sr. Backend Engineer",
    "Staff Engineer",
    "Engineering Manager, Platform",
    "Software Engineer III",
    "Software Engineer 4",
    "Tech Lead, Payments",
  ])("senior: %s", (title) => expect(isSeniorTitle(title)).toBe(true));

  it.each(["Software Engineer", "Software Engineer II", "Software Engineer, New Grad", "Associate Engineer"])(
    "not senior: %s",
    (title) => expect(isSeniorTitle(title)).toBe(false),
  );

  it("detects internships by title or employment type", () => {
    expect(isInternship("Software Engineering Intern", null)).toBe(true);
    expect(isInternship("Software Engineer", "Intern")).toBe(true);
    expect(isInternship("Software Engineer", "FullTime")).toBe(false);
    // Phase 2 review: Zoox "Contract Student Worker" requires current enrollment.
    expect(isInternship("Contract Student Worker - Software Engineer (40 hrs/wk)", null)).toBe(true);
  });

  it.each(["Software Engineer, New Grad", "Early Career Software Engineer", "Software Engineer-1", "Software Engineer I"])(
    "new-grad signal: %s",
    (title) => expect(hasNewGradSignal(title)).toBe(true),
  );

  it("no new-grad signal on a plain title", () => {
    expect(hasNewGradSignal("Software Engineer, Backend")).toBe(false);
  });
});
