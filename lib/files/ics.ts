/** Escapes TEXT values (RFC 5545 3.3.11): backslash, semicolon, comma, newlines. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds lines longer than 75 octets (RFC 5545 3.1), never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = chunks.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + bytes > limit) {
      chunks.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  chunks.push(current);
  return chunks.join("\r\n ");
}

/** 20261112T220000Z */
export function icsUtc(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type InviteInput = {
  uid: string;
  title: string;
  start: Date;
  durationMinutes: number;
  description?: string;
  url?: string;
  location?: string;
  createdAt: Date;
};

/**
 * One VEVENT in UTC. UTC times (`...Z`) are exact in every calendar app without shipping a
 * VTIMEZONE block; the local time the user asked for was converted in code (lib/files/time.ts).
 */
export function buildInvite(input: InviteInput): string {
  const end = new Date(input.start.getTime() + input.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Offer Desk//Interview Invite//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsUtc(input.createdAt)}`,
    `DTSTART:${icsUtc(input.start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsEscape(input.title)}`,
    ...(input.description ? [`DESCRIPTION:${icsEscape(input.description)}`] : []),
    ...(input.location ? [`LOCATION:${icsEscape(input.location)}`] : []),
    ...(input.url ? [`URL:${input.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
