const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  bull: "•",
};

/** Decodes HTML entities (&lt;, &amp;, &#39;, &#x2019;, ...). Unknown named entities are left as-is. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Converts HTML to readable plain text: block elements become line breaks, list items become
 * "- " bullets, scripts/styles are dropped, whitespace is tidied.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    // </li> adds nothing: the next <li> already starts a new line (avoids double-spaced bullets).
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|ul|ol|tr|section)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(text)
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Greenhouse sends HTML that is itself entity-escaped (&lt;p&gt;...). Unescape once, then convert. */
export function escapedHtmlToText(escapedHtml: string): string {
  return htmlToText(decodeEntities(escapedHtml));
}
