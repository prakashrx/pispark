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

fresh("a session's schedules: a dialog from Details, run now, switch off, on Background, delete", async ({ page }) => {
  await page.goto("/");
  await ask(page, "daily digest");

  // Details, beside the conversation, have none yet; + opens the Schedule dialog.
  const panel = page.getByRole("complementary", { name: "Details" });
  await expect(panel.getByText(/^Nothing yet\./)).toBeVisible();
  const add = panel.getByRole("button", { name: "Add a schedule" });
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add a schedule" });
  await expect(dialog).toBeVisible();

  // The form says what it will do; an empty prompt is refused in words.
  const form = dialog.getByRole("form", { name: "Add a schedule" });
  await form.getByRole("button", { name: /^Repeat:/ }).click();
  await page.getByRole("option", { name: "Weekdays", exact: true }).click();
  await form.getByLabel("At", { exact: true }).fill("09:30");
  await expect(form.getByText("Every weekday at 9:30 am", { exact: true })).toBeVisible();
  await expect(form.getByText("server time", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toHaveText("Write the prompt to send.");
  await form.getByLabel("Prompt").fill("summarise the day");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();

  const row = panel.getByRole("list", { name: "Started here" }).getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Every weekday at 9:30 am")).toBeVisible();
  await expect(row.getByText(/^Next /)).toBeVisible();
  // A schedule is listed where it belongs, in "Started here" and on Background; the session's row carries no mark for it.
  const sessions = page.getByRole("navigation", { name: "Sessions" });
  await expect(sessions.getByText(/Scheduled|Still going/)).toHaveCount(0);

  // Run now, in the schedule's dialog, sends the prompt at once; the run is recorded and the turn says it was scheduled.
  await row.getByRole("button", { name: /^Every weekday at 9:30 am/ }).click();
  const schedule = page.getByRole("dialog", { name: "Schedule" });
  await schedule.getByRole("button", { name: "Run now" }).click();
  await expect(schedule.getByText(/Ran now, by hand/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(schedule).toHaveCount(0);
  await expect(page.getByText(/^Scheduled · Every weekday at 9:30 am · /)).toBeVisible();
  await expect(page.getByText("local:summarise the day", { exact: true })).toBeVisible();

  // Switched off in its row: no next run.
  await row.getByRole("switch", { name: "Run Every weekday at 9:30 am" }).click();
  await expect(row.getByText(/^Ran .* · Off$/)).toBeVisible();

  // Background lists it among what is scheduled, naming its session; Pause all is saved and says so in the sidebar.
  await page.goto("/#/background");
  await expect(page.getByRole("heading", { level: 1, name: "Background" })).toBeVisible();
  const group = page.getByRole("region", { name: "Scheduled" });
  await expect(group.getByRole("listitem")).toContainText(/daily digest · Ran .* · Off/);
  await expect(group.getByRole("switch", { name: "Run Every weekday at 9:30 am" })).not.toBeChecked();
  await page.getByRole("switch", { name: "Pause all unattended runs" }).click();
  await expect(page.getByText(/^Paused: schedules and routines don’t run/)).toBeVisible();
  await expect(page.locator('[data-purpose="runs-paused"]')).toBeVisible();
  expect((await (await page.request.get("/api/settings")).json()).unattendedPaused).toBe(true);

  // The same dialog opens from Background; Delete asks first; Escape keeps it; Delete removes it.
  await group.getByRole("button", { name: /^Every weekday at 9:30 am/ }).click();
  await expect(schedule.getByText(/Ran now, by hand/)).toBeVisible();
  await schedule.getByRole("button", { name: "Delete" }).click();
  await expect(schedule.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(schedule.getByRole("button", { name: "Delete" })).toBeFocused();
  await schedule.getByRole("button", { name: "Delete" }).click();
  await schedule.getByRole("group", { name: "Delete this schedule" }).getByRole("button", { name: "Delete" }).click();
  await expect(schedule).toHaveCount(0);
  await expect(page.getByText(/^Nothing runs in the background/)).toBeVisible();

  // Sessions working at once is set here, a step at a time.
  const atOnce = page.getByRole("group", { name: "Sessions working at once" });
  const before = (await (await page.request.get("/api/settings")).json()).maxRunning as number;
  await atOnce.getByRole("button", { name: "More" }).click();
  await expect(atOnce).toContainText(String(before + 1));
  await expect.poll(async () => (await (await page.request.get("/api/settings")).json()).maxRunning).toBe(before + 1);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

fresh("on a phone a schedule is a full-screen sheet with Cancel, its title and Save in the bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/new");
  await ask(page, "phone digest");
  await page.goto(`${page.url()}/details`);
  await page.getByRole("button", { name: "Add a schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a schedule" });
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(389);
  expect(box.height).toBeGreaterThanOrEqual(843);
  // One Save and one Cancel, both in the bar at the top.
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(1);
  const save = (await dialog.getByRole("button", { name: "Save" }).boundingBox())!;
  expect(save.y).toBeLessThan(60);
  await dialog.getByLabel("Prompt").fill("summarise the day");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Started here" }).getByRole("listitem")).toHaveCount(1);
});
