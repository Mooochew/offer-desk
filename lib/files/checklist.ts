export type ChecklistItem = {
  ref: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  score: number | null;
  why: string | null;
  stage: string | null;
};

/** Third-party text inside Markdown: strip characters that would break a list item or a link. */
function mdText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]<>|#])/g, "\\$1").trim();
}

function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString().replace(/\)/g, "%29") : null;
  } catch {
    return null;
  }
}

/** A Markdown checklist: one section per job with an apply link and the steps to finish. */
export function buildChecklist(items: ChecklistItem[], generatedAt: string, version: number): string {
  const lines = [`# Apply checklist`, ``, `Generated ${generatedAt} by Offer Desk · version ${version} · ${items.length} job${items.length === 1 ? "" : "s"}`, ``];
  for (const item of items) {
    lines.push(`## ${mdText(item.title)} · ${mdText(item.company)} (${item.ref})`, ``);
    const facts = [
      item.location ? `Location: ${mdText(item.location)}` : null,
      item.score !== null ? `Score: ${item.score}` : null,
      item.stage ? `Stage: ${item.stage}` : null,
    ].filter(Boolean);
    if (facts.length) lines.push(facts.join(" · "), ``);
    if (item.why) lines.push(`Why it matched: ${mdText(item.why)}`, ``);
    const url = safeUrl(item.url);
    lines.push(
      `- [ ] Read the posting${url ? `: [apply link](${url})` : ""}`,
      `- [ ] Tailor resume to the listed requirements`,
      `- [ ] Submit the application`,
      `- [ ] Mark it applied in Offer Desk`,
      ``,
    );
  }
  return lines.join("\n");
}
