# Recording the demo (1–2 minutes)

The video is 30% of the grade. Record on the live URL: https://offer-desk-teal.vercel.app

## Before you record

- [ ] **Rehearse on the day you record.** Live job numbers change daily, so the counts you say out loud must come from that day's run.
- [ ] **Don't run `check:agent`, `check:ui` or the evals that day.** They spend the same per-network budget as your recording (30 chat turns per hour, 200 model calls per day). One rehearsal plus one take is about 12 turns.
- [ ] Use a **fresh incognito window** at 1440×900 or larger. A new window gives a clean session; an old one shows rehearsal history.
- [ ] Close other tabs and turn off notifications. Zoom the browser to 100%.
- [ ] Optional: dark mode looks good too. It follows your OS setting.

## The script (about 90 seconds after editing)

| # | Do | Say (roughly) | On screen |
|---|---|---|---|
| 1 | Open the page | "New-grad postings often say entry level but ask for 3+ years or a clearance. Offer Desk reads them for you." | Start here guide |
| 2 | Click **Load demo profile**, then **Seed sample pipeline** | "A new-grad CS profile, SoCal or remote, plus a few old applications." | Toasts, Pipeline tab |
| 3 | Click or type: *Find entry-level backend and full-stack roles in SoCal or remote posted this week* | "It searches about 60 company job boards. Code filters 7,917 listings down to a handful, then the LLM reads each posting." | Step list, source chips, "How 7,917 jobs became N" |
| 4 | Open **Evidence** on a card, and the **Dropped** section if there is one | "Every requirement comes with a quote, and code checks the quote before it's used." | Quotes |
| 5 | *Save the top 5 and give me an apply checklist* | "Database writes plus a real file." | File card, Pipeline |
| 6 | *Mark the first 5 as applied today; I have an interview with Coinbase Thursday at 2* (use a company from your top 5) | "Stages change and a calendar invite is created. Code does the date math." | `.ics` card |
| 7 | *Archive everything I haven't touched in 3 weeks* → **Confirm** | "Destructive actions only propose. Nothing changes until I confirm this exact list." | Confirm dialog |
| 8 | *Show my funnel this month* | "The funnel is computed in code." | Funnel tab |
| 9 | Scroll the **Action log**, open one **Arguments** | "Every tool call is logged with its arguments, status and duration." | Right panel |

## Editing

- **Cut the waits.** Each turn takes about 6–14 s. Keep a second of the spinner and the step list, and cut the rest.
- Keep the confirm dialog on screen for 2–3 seconds. It's the safety requirement.
- End on the app with the repo URL in a caption.

## Submit

1. Upload to YouTube as **Unlisted** and copy the link.
2. Google Form: https://forms.gle/nMHp5owwYidszwt58
   - Repo: https://github.com/Mooochew/offer-desk
   - Live URL: https://offer-desk-teal.vercel.app
   - Video: your YouTube link
