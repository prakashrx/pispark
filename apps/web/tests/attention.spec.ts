import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";

// Each test gets its own data folder; Default has the test extension, whose "ui-confirm" asks a question.
const fresh = hostedTest;

async function ask(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByText(`local:${text}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
}

fresh("a session that starts needing you while you are elsewhere gets a nudge; Open goes to its question", async ({ page }) => {
  await page.goto("/");
  await ask(page, "asks later");

  // A schedule whose run asks a question.
  await page.getByRole("complementary", { name: "Details" }).getByRole("button", { name: "Add a schedule" }).click();
  const form = page.getByRole("dialog", { name: "Add a schedule" }).getByRole("form");
  await form.getByLabel("Prompt").fill("ui-confirm");
  await page.getByRole("dialog", { name: "Add a schedule" }).getByRole("button", { name: "Save" }).click();

  // Elsewhere, on Background, run it: the session starts waiting for an answer.
  await page.goto("/#/background");
  await page.getByRole("region", { name: "Scheduled" }).getByRole("button", { name: /^Every day at 9:00 am/ }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule" });
  await schedule.getByRole("button", { name: "Run now" }).click();
  await page.keyboard.press("Escape");

  const nudge = page.getByRole("group", { name: "asks later needs you" });
  await expect(nudge).toBeVisible({ timeout: 15_000 });
  // It says what the session asks (set 9/2), not just that it needs you.
  await expect(nudge).toContainText("Proceed?");
  // The first nudge also offers notifications on this device (G-19); Not now is remembered.
  const offer = nudge.getByText(/even when PiSpark is closed\?/);
  await expect(offer).toBeVisible();
  await nudge.getByRole("button", { name: "Not now" }).click();
  await expect(offer).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("pispark.notifications.offer"))).toBe("no");
  await nudge.getByRole("link", { name: "Open" }).click();
  await expect(nudge).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "asks later" })).toBeVisible();
  const question = page.getByRole("group", { name: "Proceed?" });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Yes" }).click();
  await expect(question).toHaveCount(0);
});

fresh("back on a newer version, the page reloads itself when nothing is typed, and otherwise offers Reload", async ({ page }) => {
  // The server says a newer version once the page has read the first one.
  let newer = false;
  await page.route("**/api/host", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({ response, json: newer ? { ...status, version: "99.0.0" } : status });
  });
  // The page must have read the version it runs before the server starts saying a newer one.
  const first = page.waitForResponse((response) => response.url().endsWith("/api/host"));
  await page.goto("/#/new");
  await first;
  await expect(page.getByRole("textbox", { name: "Ask anything", exact: true })).toBeVisible();

  // Something typed: it is not thrown away; a banner offers the reload instead.
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("keep this");
  newer = true;
  // An update restarts the server: the page reconnects and reads everything again (here, without a restart).
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const banner = page.getByRole("status").filter({ hasText: "Updated to v99.0.0." });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(ask).toHaveText("keep this");

  // Nothing typed: the page reloads by itself onto the new version.
  const reloaded = page.waitForEvent("load");
  await ask.fill("");
  await reloaded;
  await expect(page.getByRole("textbox", { name: "Ask anything", exact: true })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

fresh("About says what is new in the version that runs: folded by default, opened with the keyboard, readable on a phone", async ({ page }) => {
  await page.goto("/#/settings/about");
  const toggle = page.getByRole("button", { name: "What’s new" });
  const notes = page.getByRole("region", { name: /^What’s new in \d+\.\d+\.\d+$/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(notes).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // The notes written with the changes, drawn as Markdown: a heading per change, for the version this build is of.
  await expect(notes.getByRole("heading", { level: 1 })).toHaveText(/^PiSpark \d+\.\d+\.\d+$/);
  await expect(notes.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(notes).toHaveCount(0);

  // On a phone: the same control, and the notes fit the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/settings/about");
  await toggle.click();
  await expect(notes.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
