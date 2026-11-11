/** Returns the timezone if the runtime knows it, else null. */
export function validTimezone(timezone: string | null | undefined): string | null {
  if (!timezone || timezone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return null;
  }
}

/** The wall-clock parts of an instant in a timezone. */
function partsIn(timezone: string, instant: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset (ms) of a timezone from UTC at an instant: local wall time minus UTC. */
function offsetMs(timezone: string, instant: Date): number {
  const p = partsIn(timezone, instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime();
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converts a local wall-clock time ("2026-11-12T14:00") in an IANA timezone to a UTC instant.
 * Handles daylight-saving changes by re-checking the offset at the computed instant.
 * Returns null for malformed or impossible input.
 */
export function zonedTimeToUtc(local: string, timezone: string): Date | null {
  const match = LOCAL_DATETIME.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(asUtc).getUTCDate() !== day) return null; // e.g. Feb 30

  let instant = asUtc - offsetMs(timezone, new Date(asUtc));
  instant = asUtc - offsetMs(timezone, new Date(instant));
  return new Date(instant);
}

/** "2026-11-10" for an instant in a timezone. */
export function localDate(instant: Date, timezone: string): string {
  const p = partsIn(timezone, instant);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "Tuesday" for an instant in a timezone. */
export function localWeekday(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(instant);
}

/** "Thu, Nov 12, 2:00 PM PST" for display. */
export function formatLocal(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}
