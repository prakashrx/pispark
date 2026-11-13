import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";

// Each test gets its own data folder.
const fresh = hostedTest;

async function ask(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByText(`local:${text}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
}

fresh("a chat's schedules: add from Chat info, run now, switch off, see them in Settings, delete", async ({ page }) => {
  await page.goto("/");
  await ask(page, "daily digest");

  // Chat info offers schedules; the panel opens over the conversation.
  await page.getByRole("button", { name: "Chat info" }).click();
  await page.getByLabel("Chat info", { exact: true }).getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Schedules for this chat")).toBeVisible();
  await expect(page.getByText(/No schedules yet/)).toBeVisible();

  // The form says what it will do; an empty prompt is refused in words; Cancel returns focus.
  await page.getByRole("button", { name: "Add schedule" }).click();
  const form = page.getByRole("form", { name: "Add a schedule" });
  await form.getByText("Weekdays", { exact: true }).click();
  await form.getByLabel("At", { exact: true }).fill("09:30");
  await expect(form.getByText("Every weekday at 9:30 am · as cron 30 9 * * 1-5 · server time")).toBeVisible();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toHaveText("Write the prompt to send.");
  await form.getByLabel("Prompt").fill("summarise the day");
  await form.getByRole("button", { name: "Save" }).click();

  const card = page.getByRole("list", { name: "Schedules" }).getByRole("listitem");
  await expect(card).toHaveCount(1);
  await expect(card.getByText("Every weekday at 9:30 am")).toBeVisible();
  await expect(card.getByText(/^Next /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add schedule" })).toBeFocused();
  // A switched-on schedule marks its chat in the sidebar.
  const chats = page.getByRole("navigation", { name: "Chats" });
  await expect(chats.getByText("Scheduled: Every weekday at 9:30 am")).toHaveCount(1);

  // Run now sends the prompt at once; the run is recorded and the turn says it was scheduled.
  await card.getByRole("button", { name: "Run now" }).click();
  await expect(card.getByText("Ran now, by hand")).toBeVisible();
  await expect(page.getByText(/^Scheduled · Every weekday at 9:30 am · /)).toBeVisible();
  await expect(page.getByText("local:summarise the day", { exact: true })).toBeVisible();

  // Switched off: no next run, no clock in the sidebar.
  await card.getByRole("switch", { name: "Run Every weekday at 9:30 am" }).click();
  await expect(card.getByText("Off", { exact: true })).toBeVisible();
  await expect(chats.getByText(/^Scheduled:/)).toHaveCount(0);

  // Settings → Schedules lists it with its chat; Pause all is saved.
  await page.goto("/#/schedules");
  await expect(page.getByRole("heading", { level: 1, name: "Schedules" })).toBeVisible();
  const all = page.getByRole("list", { name: "All schedules" }).getByRole("listitem");
  await expect(all).toHaveCount(1);
  await expect(all.getByRole("button", { name: "daily digest" })).toBeVisible();
  await page.getByRole("switch", { name: "Pause all schedules" }).click();
  await expect(page.getByText("Paused: no schedule runs.")).toBeVisible();
  expect((await (await page.request.get("/api/settings")).json()).schedulesPaused).toBe(true);

  // Delete asks first; Escape keeps it; Delete removes it.
  await all.getByRole("button", { name: "Delete" }).click();
  await expect(all.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(all.getByRole("button", { name: "Delete" })).toBeFocused();
  await all.getByRole("button", { name: "Delete" }).click();
  await all.getByRole("group", { name: "Delete this schedule" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No schedules yet.")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
