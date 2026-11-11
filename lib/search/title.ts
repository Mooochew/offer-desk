// Role and seniority rules for job titles. All matching is deterministic code; the LLM only
// fills the search `query` text, it never decides which titles match.

type RoleGroup = { name: string; queryWords: RegExp; titleWords: RegExp };

const ROLE_GROUPS: RoleGroup[] = [
  // Word boundaries matter: "Capital One" must not read as "api", "observer" not as "server".
  { name: "backend", queryWords: /back[\s-]?end|\bservers?\b|\bapis?\b|distributed/i, titleWords: /back[\s-]?end|\bserver\b|\bapi\b|distributed systems/i },
  { name: "frontend", queryWords: /front[\s-]?end|\bweb\b|\bui\b|react/i, titleWords: /front[\s-]?end|\bweb\b|\bui\b|react/i },
  { name: "fullstack", queryWords: /full[\s-]?stack/i, titleWords: /full[\s-]?stack/i },
  { name: "mobile", queryWords: /mobile|\bios\b|android/i, titleWords: /mobile|\bios\b|android/i },
  { name: "data", queryWords: /\bdata\b|analytics/i, titleWords: /\bdata\b|analytics engineer/i },
  { name: "ml", queryWords: /machine learning|\bml\b|\bai\b|\bllm/i, titleWords: /machine learning|\bml\b|\bai\b|\bllm|applied scientist|research engineer/i },
  { name: "infra", queryWords: /infra|devops|\bsre\b|reliability|cloud|platform/i, titleWords: /infra|devops|\bsre\b|site reliability|cloud|platform/i },
  { name: "security", queryWords: /security/i, titleWords: /security/i },
  { name: "embedded", queryWords: /embedded|firmware|hardware/i, titleWords: /embedded|firmware|hardware/i },
];

const HARDWARE_TITLE = ROLE_GROUPS.find((group) => group.name === "embedded")!.titleWords;

// Groups for which a plain "Software Engineer" title is still relevant.
const GENERALIST_GROUPS = new Set(["backend", "frontend", "fullstack"]);
// "Engineer" or "Developer" alone is not enough: "Battery Systems Engineer" and "Curriculum
// Developer" are not software roles.
const GENERIC_SOFTWARE_TITLE = /software|\bswe\b|\bsde\b|programmer/i;
// Every match must be a building role, so "Operations Analyst, Platform" can't match "platform".
const BUILDER_TITLE = /engineer|developer|programmer|scientist|\bswe\b|\bsde\b/i;

/** Which role groups a free-text query asks for. Empty means "any engineering role". */
export function rolesInQuery(query: string): string[] {
  return ROLE_GROUPS.filter((group) => group.queryWords.test(query)).map((group) => group.name);
}

/**
 * True if the title fits any of the requested roles. With no roles requested, any software role
 * fits (a role group or a generic software title), but not other engineering such as hardware.
 */
export function titleMatchesRoles(title: string, roles: string[]): boolean {
  if (!BUILDER_TITLE.test(title)) return false;
  if (roles.length === 0) {
    return GENERIC_SOFTWARE_TITLE.test(title) || ROLE_GROUPS.some((group) => group.name !== "embedded" && group.titleWords.test(title));
  }
  // A hardware/firmware/embedded title only fits when those roles were asked for: "Server Hardware
  // Systems Engineer" contains "server" but is not a backend role (Phase 5 review N11).
  if (!roles.includes("embedded") && HARDWARE_TITLE.test(title)) return false;
  const matchesGroup = ROLE_GROUPS.some((group) => roles.includes(group.name) && group.titleWords.test(title));
  if (matchesGroup) return true;

  const anyGroupInTitle = ROLE_GROUPS.some((group) => group.titleWords.test(title));
  const wantsGeneralist = roles.some((role) => GENERALIST_GROUPS.has(role));
  return wantsGeneralist && !anyGroupInTitle && GENERIC_SOFTWARE_TITLE.test(title);
}

const SENIOR_WORDS = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|vice president|architect|distinguished|fellow|chief)\b/i;
const SENIOR_LEVEL = /\b(iii|iv|v|vi)\b|\b(engineer|developer)\s+[3-9]\b|\b[le][5-9]\b/i;
// "Student Worker" roles require current enrollment, so graduated new grads can't apply.
const INTERN_WORDS = /\bintern(ship)?\b|\bco-?op\b|\bstudent\b/i;
const NEW_GRAD_WORDS = /new grad|graduate|entry[\s-]level|early[\s-]career|junior|university|\bassociate\b|\b(engineer|developer)[\s-]+(i|1)\b/i;

/** Title says the role is above new-grad level (senior, staff, lead, manager, level III+, ...). */
export function isSeniorTitle(title: string): boolean {
  return SENIOR_WORDS.test(title) || SENIOR_LEVEL.test(title);
}

export function isInternship(title: string, employmentType: string | null): boolean {
  return INTERN_WORDS.test(title) || /intern/i.test(employmentType ?? "");
}

/** Title explicitly targets new grads / entry level. Used as a scoring bonus later, not a filter. */
export function hasNewGradSignal(title: string): boolean {
  return NEW_GRAD_WORDS.test(title);
}
