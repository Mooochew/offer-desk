// Live UI check (Phase 5): clicks through the PLAN section 9 demo in a real browser (headless Edge
// or Chrome via playwright-core; no browser download) and asserts what the user sees at each step.
// Uses 6 chat turns. The test user and its files are deleted at the end.
// Run against a local build:  npm run build && npm start   then   npm run check:ui
// Or the deployment:          BASE_URL=https://offer-desk-teal.vercel.app npm run check:ui
// Browser: BROWSER_CHANNEL=msedge (default) | chrome. Screenshots: SHOTS=<dir> (optional).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SHOTS = process.env.SHOTS;
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

let failures = 0;
function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
}

process.on("unhandledRejection", () => {}); // a pending navigation at browser close must not skip cleanup
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "America/Los_Angeles", acceptDownloads: true });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => message.type() === "error" && errors.push(message.text()));

const shot = async (name: string) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const userIdIn = (p: Page) =>
  p.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    return key ? (JSON.parse(localStorage.getItem(key)!).user.id as string) : null;
  });
async function ask(text: string) {
  const started = Date.now();
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Working on it", { exact: false }).waitFor({ state: "attached", timeout: 5_000 }).catch(() => {});
  await page.getByText("Working on it", { exact: false }).waitFor({ state: "detached", timeout: 120_000 });
  await page.waitForTimeout(1_500); // state refresh after the turn
  console.log(`  » ${text} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}
const actionLog = () => page.getByRole("region", { name: "Action log" });

let userId: string | null = null;
try {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1_000);
  userId = await userIdIn(page);
  check("page loads with an anonymous session", Boolean(userId));
  check("first-time visitors see what to do", await page.getByText("Start here").isVisible());

  await page.getByRole("button", { name: "Load demo profile" }).click();
  await page.getByText("Demo profile loaded").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Seed sample pipeline" }).click();
  await page.getByText(/sample applications|already there/).waitFor({ timeout: 15_000 });
  const board = await page.getByRole("region", { name: "Saved column" }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check("seeding switches to the pipeline board", board);
  await shot("01-seeded");

  await ask("Find entry-level backend and full-stack roles in SoCal or remote posted this week");
  check("results tab shows the funnel from code", await page.getByText(/^How [\d,]+ jobs became \d+/).isVisible());
  const ranked = await page.locator("li[data-company]").count();
  check("ranked job cards are shown", ranked > 0, `${ranked}`);
  check("source status chips are shown", (await page.getByText(/boards$/).count()) > 0);
  check("the step timeline shows the tool calls", (await page.getByText("Search jobs").count()) > 0 && (await page.getByText("Triage results").count()) > 0);
  // Companies of the top 5, read now (later turns switch the board to the pipeline tab).
  const companies = (await page.locator("li[data-company]").evaluateAll((items) => items.map((item) => item.getAttribute("data-company") ?? ""))).slice(0, 5);
  await page.getByText("Evidence").first().click();
  check("the evidence popover shows quotes", await page.getByText("Quotes are copied from the posting").first().isVisible());
  await shot("02-results");

  await ask("Save the top 5 and give me an apply checklist");
  const download = await Promise.all([page.waitForEvent("download", { timeout: 20_000 }), page.getByRole("button", { name: "Download" }).first().click()]).then(([item]) => item).catch(() => null);
  const markdown = download ? readFileSync((await download.path())!, "utf8") : "";
  check("the checklist file card downloads the Markdown file", markdown.startsWith("# Apply checklist"), download?.suggestedFilename());
  await shot("03-saved");

  // A company that appears once in the top 5; with two jobs at one company the agent rightly asks which.
  const company = companies.find((name) => companies.filter((other) => other === name).length === 1) ?? companies[0];
  await ask(`Mark the first 5 as applied today. I have an interview with ${company} Thursday at 2`);
  check("an interview invite card shows Thursday 2:00 PM", (await page.getByText(/Thu, Nov \d+, 2:00 PM/).count()) > 0);
  await shot("04-interview");

  await ask("Archive everything I haven't touched in 3 weeks");
  const dialog = page.locator("dialog[open]");
  check("archive opens the confirmation dialog", await dialog.isVisible());
  const previewCount = Number((await dialog.getByRole("button", { name: /^Confirm/ }).textContent())?.match(/\d+/)?.[0] ?? -1);
  check("the dialog lists exactly the previewed items", (await dialog.locator("li").count()) === previewCount, `${previewCount}`);
  const archivedBefore = await admin.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId!).eq("stage", "archived");
  check("nothing is archived before confirming", archivedBefore.count === 0, `${archivedBefore.count}`);
  await shot("05-dialog");
  await dialog.getByRole("button", { name: /^Confirm/ }).click();
  await page.getByText(/Done: archived \d+ application/).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1_500); // state refresh after confirm
  const chat = page.getByRole("region", { name: "Chat" });
  const archived = await admin.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId!).eq("stage", "archived");
  check("confirm archives the previewed items and the chat stops asking", archived.count === previewCount && (await chat.getByRole("button", { name: "Review" }).count()) === 0, `${archived.count} archived`);
  await shot("06-confirmed");

  await ask("Show my funnel this month");
  check("the funnel tab opens with the chart", await page.getByRole("list", { name: "Funnel chart" }).isVisible());
  await page.getByRole("button", { name: "Show table" }).click();
  check("the funnel has a table view", await page.getByRole("cell", { name: "Got a response" }).isVisible());
  await shot("07-funnel");

  await ask("Delete the apply checklist file");
  await page.locator("dialog[open]").getByRole("button", { name: "Cancel" }).click();
  await page.getByText("Cancelled. Nothing changed.").waitFor({ timeout: 10_000 });
  const cancelled = await actionLog().getByText("Cancelled").first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  const files = await admin.from("files").select("id", { count: "exact", head: true }).eq("user_id", userId!);
  check("cancel leaves the file and logs the cancellation", cancelled && (files.count ?? 0) >= 2, `${files.count} files`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2_500);
  check("after a reload, chat history, results and the log are still there",
    (await page.getByText("Show my funnel this month").count()) > 0 && (await page.getByText(/^How [\d,]+ jobs became/).count()) > 0 && (await actionLog().getByText("Archive applications").count()) > 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^log$/i }).click();
  check("on a phone the panels become tabs", await actionLog().isVisible());
  await shot("08-mobile");

  const { data: log } = await admin.from("action_log").select("status").eq("user_id", userId!);
  check("no action is left without a final status", (log ?? []).every((row) => !["proposed", "confirmed"].includes(row.status)), `${log?.length} rows`);
  check("no errors in the browser console", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (error) {
  failures++;
  console.error("✗ UI check crashed:", (error as Error).message);
  await shot("crash").catch(() => {});
  userId ??= await userIdIn(page).catch(() => null);
} finally {
  await browser.close().catch(() => {});
  if (userId) {
    const { data: folders } = await admin.storage.from("exports").list(userId);
    for (const folder of folders ?? []) {
      const { data: files } = await admin.storage.from("exports").list(`${userId}/${folder.name}`);
      if (files?.length) await admin.storage.from("exports").remove(files.map((file) => `${userId}/${folder.name}/${file.name}`));
    }
    await admin.auth.admin.deleteUser(userId);
  }
}

console.log(failures === 0 ? "\nUI check passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
