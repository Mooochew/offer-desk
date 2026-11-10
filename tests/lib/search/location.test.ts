import { describe, expect, it } from "vitest";
import { expandPlace, isUsRemote, isUsRemoteText, matchesLocation } from "@/lib/search/location";
import type { RemoteType } from "@/lib/sources/types";

const job = (locations: string[], remote: RemoteType = "unknown") => ({ locations, remote });

describe("isUsRemoteText", () => {
  it.each(["Remote (US)", "Remote - USA", "Remote, United States", "Remote", "Remote-first", "Seattle, WA - Remote", "Remote (West Coast)"])(
    "US-remote: %s",
    (location) => expect(isUsRemoteText(location)).toBe(true),
  );

  // "Remote, KSA" passed as US-remote in the first live run (Phase 2).
  it.each(["Remote, KSA", "Remote - Canada", "Remote (Europe)", "Remote, India", "Remote - Latin America", "Remote, South America"])("not US-remote: %s", (location) =>
    expect(isUsRemoteText(location)).toBe(false),
  );
});

describe("isUsRemote", () => {
  // Regression: ElevenLabs listed ["Remote", "Europe", "Poland", "United Kingdom"].
  it("a bare 'Remote' next to non-US places is not US-remote", () => {
    expect(isUsRemote(job(["Remote", "Europe", "Poland", "United Kingdom"]))).toBe(false);
  });

  it("a bare 'Remote' alone or next to a US place is US-remote", () => {
    expect(isUsRemote(job(["Remote"]))).toBe(true);
    expect(isUsRemote(job(["Remote", "New York, NY"]))).toBe(true);
  });

  it("source-marked remote with US offices counts; with only foreign offices it doesn't", () => {
    expect(isUsRemote(job(["New York, NY"], "remote"))).toBe(true);
    expect(isUsRemote(job(["London"], "remote"))).toBe(false);
    expect(isUsRemote(job([], "remote"))).toBe(true);
    expect(isUsRemote(job(["Austin, TX"], "hybrid"))).toBe(false);
  });

  it("', IN' is not treated as Indiana (it is usually India)", () => {
    expect(isUsRemote(job(["Remote, IN"]))).toBe(false);
  });
});

describe("matchesLocation", () => {
  const socal = { places: ["socal"], remoteOk: false };

  it.each(["Irvine, California, United States", "Hawthorne, CA", "Santa Monica, CA", "San Diego, CA"])(
    "SoCal includes %s",
    (location) => expect(matchesLocation(job([location]), socal)).toBe(true),
  );

  it("SoCal excludes the Bay Area", () => {
    expect(matchesLocation(job(["San Francisco, CA"]), socal)).toBe(false);
  });

  it("matches any of a job's locations", () => {
    expect(matchesLocation(job(["New York, NY", "Culver City, CA"]), socal)).toBe(true);
  });

  it("remote OK adds US-remote jobs", () => {
    expect(matchesLocation(job(["Remote (US)"]), { places: ["socal"], remoteOk: true })).toBe(true);
    expect(matchesLocation(job(["Remote (US)"]), socal)).toBe(false);
  });

  it("no preference matches everything", () => {
    expect(matchesLocation(job(["Tokyo"]), { places: [], remoteOk: false })).toBe(true);
  });

  it("free-text places work too", () => {
    expect(matchesLocation(job(["Denver, CO"]), { places: ["Denver"], remoteOk: false })).toBe(true);
  });
});

describe("expandPlace", () => {
  it("resolves aliases to regions", () => {
    expect(expandPlace("LA")).toContain("irvine");
    expect(expandPlace("SF")).toContain("palo alto");
    expect(expandPlace("Portland")).toEqual(["portland"]);
  });
});
