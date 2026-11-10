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

/** True if the skill's name appears as a word in the text (used on titles for the pre-rank). */
export function skillInText(skill: string, text: string): boolean {
  const name = normalizeSkill(skill).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${name}([^a-z0-9]|$)`, "i").test(text);
}
