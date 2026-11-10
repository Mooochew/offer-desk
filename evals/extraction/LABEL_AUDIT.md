# Extraction eval: label audit

An independent AI labeler (not the one that drafted the labels) checked all 16 cases in `cases.json` against `LABELING.md`.

**Method.** Step 1, blind: for each posting I read the full description (including the legal and benefits boilerplate at the end), the title and the listed locations, and labeled all 5 fields with a supporting quote. I did not look at `expected` or the `why` notes during this step. Step 2: I compared my labels with the existing ones and adjudicated any differences. Step 3: I would have changed only labels I was confident were wrong.

## Summary (before adjudication)

| Field | Agreement |
|---|---|
| `years_required_min` | 16 / 16 (100%) |
| `clearance_required` | 16 / 16 (100%) |
| `location_type` | 16 / 16 (100%) |
| `degree` | 16 / 16 (100%) |
| `is_new_grad_friendly` | 16 / 16 (100%) |
| **Overall** | **80 / 80 (100%)** |

**Label changes: none.** The only edit to `cases.json` is the top-level `status` string.

Full agreement does not prove the labels are right. Several cases sit on the edge of a rule, and two labelers applying the same rules can share the same blind spot. Those cases are listed below.

## Disagreements

None. The table is kept so the format is complete.

| Case | Field | Existing | Mine (blind) | Final | Supporting quote | Reason |
|---|---|---|---|---|---|---|
| (none) | | | | | | |

## Blind labels with evidence

| # | Case | years | clearance | location | degree | new grad | Key quotes |
|---|---|---|---|---|---|---|---|
| 0 | Verkada, Backend SWE University Grad 2027 | null | unknown | onsite | bachelors | yes | "Internship experience" (no years); "Match vests on 2 year anniversary" (benefit, not experience); "onsite five days per week"; "BS/MS in Computer Science"; title "University Graduate 2027" |
| 1 | Coinbase, Software Engineer-1 | 2 | unknown | remote | unknown | unknown | "2+ years of software engineering experience"; listed "Remote - USA", "remote-first" (quarterly "surges" are not part-week office days) |
| 2 | Affirm, SWE II Backend | 1.5 | unknown | remote | bachelors | unknown | "a total of 1.5+ years"; "Remote US", "#LI-Remote"; "either equivalent practical experience or a Bachelor's degree" |
| 3 | Roblox, SWE Engine Productivity | 1 | unknown | hybrid | unknown | unknown | "1–3 years of experience ... (internships or industry experience)"; "onsite Tuesday, Wednesday, and Thursday" |
| 4 | Amplitude, SWE II | 2 | unknown | hybrid | unknown | unknown | "You have 2–4 years of experience"; "San Francisco- Hybrid" |
| 5 | SpaceX, Full Stack SWE | 1 | unknown | onsite | bachelors | unknown | "Bachelor's degree ... OR 2+ years ... in lieu of a degree" + "1+ years of experience in full stack development"; ITAR citizenship is not a clearance; "This role requires you to be onsite" |
| 6 | Anduril, Sentry Software | 2 | ability_to_obtain | unknown | unknown | unknown | "plus 2+ years in Rust or C++"; "eligibility to obtain and maintain a US security clearance"; no work-mode statement; "Strong engineering background from industry or school" (not a degree) |
| 7 | Anduril, FDSE JBLM | 3 | yes | remote | unknown | no | "Currently possesses ... an active U.S. Secret Clearance"; "At least 3-10+ years"; listed location "Remote" |
| 8 | Smartsheet, SWE I | 1 | unknown | remote | bachelors | unknown | "1+ years" (x3) and "6+ months" (all required, so the larger, 1); "For over 20 years" is company age; "-REMOTE, USA-", "#LI-Remote"; "A degree in Computer Science ... or equivalent practical experience" |
| 9 | Zoox, Contract Student Worker | 0 | unknown | onsite | bachelors | no | "0-2 years"; "Able to work on-site"; "Bachelor's degree (completed, or in progress/recently completed)"; "Currently enrolled in a B.S. or M.S. program" |
| 10 | Twitch, SWE I | null | unknown | unknown | bachelors | unknown | "Experience developing software in a professional environment" (no years); "Minimum of Bachelor's degree ... or equivalent experience"; no work-mode statement |
| 11 | Notion, SWE Web Infra | null | unknown | hybrid | unknown | yes | "As a junior engineer on the team"; "We work from our offices on Mondays, Tuesdays and Thursdays" |
| 12 | Figma, SWE Application Platform | 5 | unknown | remote | unknown | no | "5+ years ... including 3+ years ... Ruby"; "from one of our US hubs or remotely in the United States" |
| 13 | Headway, Security Engineer D&R | 4 | unknown | remote | unknown | no | "1-2+ years ... OR a security-adjacent engineering background" AND "4-5+ years in related areas"; listed "Remote" |
| 14 | Stripe, SWE Full stack | 2 | unknown | hybrid | bachelors | unknown | "Bachelor's degree ... plus 2 years"; "50% Telecommuting permitted." |
| 15 | Writer, AI deployment engineer | 5 | unknown | hybrid | unknown | no | "Over 5 years ... with at least 3 years specifically"; "This is a hybrid role" |

## Rule ambiguities and suggested LABELING.md wording

None of these changed a label. Each one is a place where a reasonable labeler (or the model) could defensibly answer differently, so the rule should be tightened before the scores are reported.

1. **New-grad rule conflict (Zoox).** The posting meets a `yes` trigger ("requires 0 years": "0-2 years") and a `no` trigger ("Currently enrolled in a B.S. or M.S. program") at once. The degree bullet even says "in progress/recently completed". The tricky-case list shows the intent is `no`, but the table gives no precedence. Suggested addition: *"If both a `yes` and a `no` condition apply, `no` wins. A current-enrollment requirement makes it `no` even if 0 years or 'recent graduates' are mentioned elsewhere."*
2. **Degree with no level (Smartsheet).** "A degree in Computer Science, Engineering, or a related field" is required but has no level. `unknown` means "not mentioned", which doesn't fit, so `bachelors` is the best fit. Suggested addition: *"A required 'degree' in a field with no level stated → `bachelors`."*
3. **Hub-or-remote (Figma).** "from one of our US hubs or remotely" is a choice, not part-week office days. Suggested addition: *"If fully remote work is an allowed option, label `remote`, even if office work is also allowed."*
4. **Listed "Remote" vs. other signals (Anduril JBLM).** The listed location is "Remote", but the title names a base (JBLM, "Forward Deployed") and the role requires 10–30% travel. Travel isn't office days, so `remote` follows the rule. Suggested addition: *"Travel requirements don't change the work mode."*
5. **Conflicting tags (Notion).** The text says three anchor days (hybrid), but the boilerplate has `#LI-Onsite`. Suggested addition: *"Explicit office-day statements beat LinkedIn hashtags (#LI-Onsite / #LI-Remote / #LI-Hybrid). Use a hashtag only when nothing else is stated."*
6. **Years inside an OR bullet (SpaceX, Headway).** The rule covers alternatives across bullets but not a single bullet like "degree OR 2+ years" or "1-2+ years OR an adjacent background". Here one branch has no years, so the bullet adds no minimum. Suggested addition: *"If one alternative in a bullet has no year count, that bullet adds no year minimum."* Neither final value depends on this (SpaceX → 1, Headway → 4 either way), but a model could output 2 for SpaceX or 1 for Headway.
7. **Implied but unstated onsite (Anduril Sentry).** "comfort working on a bench with the hardware in front of you" and "the people using what you built are in the same building" strongly suggest onsite, but nothing states a work mode, so the strict rule gives `unknown`. This is intended. It may be worth adding as a named tricky case so nobody "fixes" it to `onsite`.
8. **Small doc inaccuracy.** The tricky-case list says the Writer posting has an "Entry-level" title. Its title is "AI deployment engineer (East)", and the `why` note says it only matched the title filter. Suggested rewording: *"Postings that look entry-level (level-1 title or matched the new-grad filter) but require 2+ to 5+ years (Coinbase, Writer)."* This doesn't affect any label.

## Cases most worth a human glance

1. **Zoox** (`is_new_grad_friendly` = no): rule conflict #1. It's the only case where two rules point opposite ways.
2. **Anduril JBLM** (`location_type` = remote): listed "Remote" vs. a forward-deployed, base-named role.
3. **Smartsheet** (`degree` = bachelors): a degree with no level stated.
4. **Figma** (`location_type` = remote): hub-or-remote option. Some would say hybrid.
5. **Anduril Sentry** (`location_type` = unknown): strong onsite hints but no explicit statement.
