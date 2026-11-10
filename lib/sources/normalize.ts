import { createHash } from "node:crypto";
import type { RemoteType } from "./types";

// Titles worth keeping for a software-engineering job search. Checked at cache time, so
// sales, legal, recruiting, etc. never enter the cache.
const ENGINEERING_TITLE =
  /\b(engineer(ing)?|developer|software|swe|sde|programmer|devops|sre|site reliability|data scientist|machine learning|ml|ai|full[\s-]?stack|front[\s-]?end|back[\s-]?end|ios|android|mobile|firmware|embedded|infrastructure|platform|security|cloud|qa|test automation|research scientist|applied scientist)\b/i;

// Engineering-ish words that, alone, usually mean a non-builder role.
const NON_ENGINEERING_TITLE = /\b(sales engineer|solutions? engineer|engineering recruiter|recruiter|account executive|counsel|attorney)\b/i;

export function isEngineeringTitle(title: string): boolean {
  return ENGINEERING_TITLE.test(title) && !NON_ENGINEERING_TITLE.test(title);
}

export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

const WORKPLACE_TYPES: Record<string, RemoteType> = {
  onsite: "onsite",
  "on-site": "onsite",
  hybrid: "hybrid",
  remote: "remote",
};

/**
 * Remote status, in priority order (DECISIONS 008): the source's explicit workplace type,
 * then its isRemote flag, then "remote" in the location text. Otherwise unknown.
 */
export function remoteFrom(input: { workplaceType?: string | null; isRemote?: boolean | null; locationText?: string | null }): RemoteType {
  const workplace = input.workplaceType?.toLowerCase().replace(/\s|_/g, "");
  if (workplace && WORKPLACE_TYPES[workplace]) return WORKPLACE_TYPES[workplace];
  if (input.isRemote === true) return "remote";
  if (input.locationText && /\bremote\b/i.test(input.locationText)) return "remote";
  return "unknown";
}

/** Converts a date string or epoch milliseconds to ISO, or null if missing/invalid. */
export function toIsoDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Stable hash of a description, used as the extraction cache key. */
export function descriptionHash(description: string): string {
  return createHash("sha256").update(description.trim()).digest("hex");
}
