# Extraction eval: labeling guide

`cases.json` holds 16 real postings from `data/sample_postings.json` (matched by `source` + `sourceId`) with the **correct** values the extraction step should return. The eval in Phase 3 scores each prompt version against these labels. The labels are the spec: if the guide and the prompt disagree, the guide wins.

**Status:** draft labels written by Claude. **A person must check them** before Phase 3 uses them. For each case, open the posting's text in `data/sample_postings.json`, read the `why` note, and confirm or fix each field. This takes about 20 minutes.

## Fields and rules

The extractor sees the title, company, listed locations and the full description. It only reports what is **stated**; nothing is inferred.

| Field | Values | Rule |
|---|---|---|
| `years_required_min` | number or `null` | The smallest number of years of experience the **required** section asks for. A range "1–3 years" → 1. "Over 5 years" → 5. Years listed only under *preferred* / *nice to have* / *bonus* don't count. Years that aren't about the candidate's experience (company age, vesting, benefits) don't count. Nothing stated → `null`. If several required bullets each give years (A **and** B), use the larger minimum, because both must be met. If they're alternatives (A **or** B), use the smaller. |
| `clearance_required` | `yes`, `no`, `ability_to_obtain`, `unknown` | `yes`: must already hold an active clearance. `ability_to_obtain`: must be eligible to obtain one. `no`: the posting explicitly says no clearance is needed. Not mentioned → `unknown`. Citizenship or export-control (ITAR) rules are **not** a clearance. |
| `location_type` | `onsite`, `hybrid`, `remote`, `unknown` | From explicit statements ("onsite five days", "hybrid", "remote in the US", office days per week) or a listed location that says "Remote". Part-week office days → `hybrid`. Nothing stated → `unknown`. |
| `degree` | `none`, `bachelors`, `masters`, `phd`, `unknown` | The lowest degree listed as required, even if "or equivalent experience" is allowed. "BS/MS" → `bachelors`. Explicitly not required → `none`. Not mentioned → `unknown`. |
| `is_new_grad_friendly` | `yes`, `no`, `unknown` | `yes`: the posting explicitly targets new grads, students, junior or early-career people, **or** requires 0 years, **or** has a level-I title with no years requirement. `no`: requires 3+ years, an active clearance, or is clearly senior. Otherwise `unknown`. |

Skills and evidence quotes are also extracted but aren't scored (too subjective to label reliably in the time available).

## The tricky cases these labels cover

- "Entry-level" title but 2+ to 5+ years required (Coinbase, Writer)
- Numbers that aren't experience: 401(k) vesting (Verkada), company age (Smartsheet)
- "1.5+ years" that a careless read turns into "5+" (Affirm)
- Ranges (Roblox 1–3, Amplitude 2–4, Zoox 0–2)
- Years as an alternative to a degree, not a requirement (SpaceX)
- Export-control citizenship that isn't a clearance (SpaceX) vs. ability to obtain (Anduril Sentry) vs. active clearance (Anduril JBLM)
- No requirements stated at all (Twitch, Notion)
- Two required year counts that must both be met (Headway)
