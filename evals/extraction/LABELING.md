# Extraction eval: labeling guide

`cases.json` holds 16 real postings from `data/sample_postings.json` (matched by `source` + `sourceId`) with the **correct** values the extraction step should return. The eval in Phase 3 scores each prompt version against these labels. The labels are the spec: if the guide and the prompt disagree, the guide wins.

**Status:** draft labels written by Claude; three were corrected after the Phase 2 independent review (Stripe, Twitch, Zoox). **A person must check them** before Phase 3 uses them. For each case, open the posting's text in `data/sample_postings.json`, read the `why` note, and confirm or fix each field. This takes about 20 minutes.

## Fields and rules

The extractor sees the title, company, listed locations and the full description. It only reports what is **stated**; nothing is inferred.

| Field | Values | Rule |
|---|---|---|
| `years_required_min` | number or `null` | The smallest number of years of experience the **required** section asks for. A range "1–3 years" → 1. "Over 5 years" → 5. Years listed only under *preferred* / *nice to have* / *bonus* don't count. Years that aren't about the candidate's experience (company age, vesting, benefits) don't count. Nothing stated → `null`. If several required bullets each give years (A **and** B), use the larger minimum, because both must be met. If they're alternatives (A **or** B), use the smaller. |
| `clearance_required` | `yes`, `no`, `ability_to_obtain`, `unknown` | `yes`: must already hold an active clearance. `ability_to_obtain`: must be eligible to obtain one. `no`: the posting explicitly says no clearance is needed. Not mentioned → `unknown`. Citizenship or export-control (ITAR) rules are **not** a clearance. |
| `location_type` | `onsite`, `hybrid`, `remote`, `unknown` | From explicit statements ("onsite five days", "hybrid", "remote in the US", office days per week, "50% telecommuting permitted") or a listed location that says "Remote". Part-week office days or partial telecommuting → `hybrid`. Nothing stated → `unknown`. Check the end of the posting too: legal boilerplate often holds the work-mode line. |
| `degree` | `none`, `bachelors`, `masters`, `phd`, `unknown` | The lowest degree listed as required, even if "or equivalent experience" is allowed. "BS/MS" → `bachelors`. Explicitly not required → `none`. Not mentioned → `unknown`. |
| `is_new_grad_friendly` | `yes`, `no`, `unknown` | `yes`: the posting explicitly targets new grads, recent graduates, junior or early-career people, **or** requires 0 years. A level-I title alone is not enough. `no`: requires 3+ years, an active clearance, current student enrollment (graduates can't apply), or is clearly senior. Otherwise `unknown`. |

## Tie-breakers (from the independent label audit, `LABEL_AUDIT.md`)

- **New-grad conflicts:** if a `yes` condition and a `no` condition both apply (e.g. "0-2 years" but "currently enrolled"), `no` wins.
- **Degree with no level:** a required "degree in Computer Science or related field" with no level stated → `bachelors`.
- **Office or remote:** if fully remote is an allowed option ("from one of our US hubs or remotely"), → `remote`.
- **Travel** requirements don't change the work mode.
- **Explicit beats hashtags:** a stated office schedule wins over `#LI-Remote` / `#LI-Hybrid` tags.
- **Years inside an OR bullet:** if one option in a single bullet has no year count (e.g. "a degree OR 2+ years"), that bullet adds no minimum.

## Reading the scores

Report each field's accuracy **next to a trivial baseline**: the score of a "model" that always gives the most common label (for example, 14 of 16 cases have clearance `unknown`, so always answering `unknown` already scores 87.5% on clearance). A prompt only helps where it beats that baseline. The rare cases (an active clearance, ability to obtain) matter most.

Skills and evidence quotes are also extracted but aren't scored (too subjective to label reliably in the time available).

## The tricky cases these labels cover

- Titles that pass the entry-level filter but require 2+ to 5+ years (Coinbase "Software Engineer-1", Writer "AI deployment engineer")
- Numbers that aren't experience: 401(k) vesting (Verkada), company age (Smartsheet)
- "1.5+ years" that a careless read turns into "5+" (Affirm)
- Ranges (Roblox 1–3, Amplitude 2–4, Zoox 0–2)
- Years as an alternative to a degree, not a requirement (SpaceX)
- Export-control citizenship that isn't a clearance (SpaceX) vs. ability to obtain (Anduril Sentry) vs. active clearance (Anduril JBLM)
- No requirements stated at all (Notion), or no years but other experience required (Twitch)
- Work mode buried in legal boilerplate (Stripe "50% Telecommuting permitted")
- Student-only role that new grads can't apply to (Zoox)
- Two required year counts that must both be met (Headway)
