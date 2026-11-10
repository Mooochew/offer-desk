// Skill names vary between postings and profiles ("JS", "Javascript", "javascript"). Normalizing
// both sides lets code compare them; the LLM only lists the skills it read.

const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  "node": "node.js",
  nodejs: "node.js",
  "react.js": "react",
  reactjs: "react",
  "next": "next.js",
  nextjs: "next.js",
  golang: "go",
  postgres: "postgresql",
  psql: "postgresql",
  k8s: "kubernetes",
  "amazon web services": "aws",
  "google cloud": "gcp",
  "google cloud platform": "gcp",
  "c plus plus": "c++",
  cpp: "c++",
  "rest": "rest apis",
  "rest api": "rest apis",
  restful: "rest apis",
  "restful apis": "rest apis",
  py: "python",
};

export function normalizeSkill(skill: string): string {
  const key = skill.toLowerCase().replace(/\s+/g, " ").trim();
  return ALIASES[key] ?? key;
}

/** Profile skills that appear in the given list (compared after normalizing). */
export function matchingSkills(profileSkills: readonly string[], postingSkills: readonly string[]): string[] {
  const posting = new Set(postingSkills.map(normalizeSkill));
  return profileSkills.filter((skill) => posting.has(normalizeSkill(skill)));
}

/** Every spelling of a skill: as given, its normalized name, and each alias of that name. */
function spellings(skill: string): string[] {
  const normalized = normalizeSkill(skill);
  const aliases = Object.entries(ALIASES).filter(([, name]) => name === normalized).map(([alias]) => alias);
  return [...new Set([skill.toLowerCase().trim(), normalized, ...aliases])];
}

/**
 * True if any spelling of the skill appears as a whole word in the text ("Postgres" finds
 * "PostgreSQL" and "postgres"; "Go" doesn't match "Google"). Used on titles (pre-rank) and on
 * descriptions (to ground the model's skill lists).
 */
export function skillInText(skill: string, text: string): boolean {
  return spellings(skill).some((spelling) => {
    const name = spelling.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9+#])${name}([^a-z0-9+#]|$)`, "i").test(text);
  });
}

/**
 * Keeps only the skills that actually appear in the text. Skills drive half the score, so they
 * must be grounded like every other field (Phase 3 review S4: the model's skill lists varied
 * between runs on the same posting).
 */
export function groundedSkills(skills: readonly string[], text: string): string[] {
  return skills.filter((skill) => skillInText(skill, text));
}
