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
  await page.getByRole("region", { name: "asks later" }).getByRole("button", { name: /^Every day at 9:00 am/ }).click();
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
  await page.goto("/#/new");
  await expect(page.getByRole("textbox", { name: "Ask anything", exact: true })).toBeVisible();

  // Something typed: it is not thrown away; a banner offers the reload instead.
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("keep this");
  newer = true;
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
