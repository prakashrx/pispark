import { newSession } from "./ask";
import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { openAgent, openTab } from "./agent-journey";

// Each test gets its own data folder. "Log app" is an app agent: its home is the Log view its extension offers.
const fresh = hostedTest;

const apps = (page: Page) => page.getByRole("navigation", { name: "Apps" });
const sessions = (page: Page) => page.getByRole("navigation", { name: "Sessions" });
const toggle = (page: Page) => apps(page).getByRole("button", { name: "Sessions of Log app" });
const started = (page: Page) => apps(page).getByRole("link", { name: /^Started / });

fresh("an app is opened from the sidebar on its home view, and its sessions are listed under it", async ({ page }) => {
  await page.goto("/");
  const app = apps(page).getByRole("button", { name: "Log app", exact: true });
  await expect(app).toBeVisible();
  // It has no session yet, so there is nothing to unfold.
  await expect(toggle(page)).toHaveCount(0);

  // By keyboard. No message is sent: the session is made and shows the app's home view.
  await app.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Log", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Log app", exact: true })).toBeVisible();
  const show = page.getByRole("radiogroup", { name: "Show" });
  await expect(show.getByRole("radio", { name: "Log" })).toBeChecked();
  // It is listed under its app, which is open around it, and not among the sessions.
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(started(page)).toHaveCount(1);
  await expect(started(page)).toHaveAttribute("aria-current", "page");
  await expect(sessions(page)).toContainText("No sessions yet.");

  // Any session shows as a conversation, and that choice is kept for it.
  await show.getByRole("radio", { name: "Log" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("main")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Log app", exact: true })).toBeVisible();

  // New session makes a second one, which opens on the home view again.
  await apps(page).getByRole("button", { name: "New session" }).click();
  await expect(started(page)).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Log", exact: true })).toBeVisible();
  // Opening the app goes to its newest session: nothing new is made.
  await app.click();
  await expect(started(page)).toHaveCount(2);

  // Folded by keyboard, the row itself says where you are.
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(toggle(page)).toBeFocused();
  await expect(started(page)).toHaveCount(0);
  await expect(app).toHaveAttribute("aria-current", "page");

  // On a phone the list is its own screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await toggle(page).click();
  await expect(started(page)).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

fresh("sessions stay in the session list; an app started from Ask is listed under the app by its title", async ({ page }) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("an ordinary session");
  await ask.press("Enter");
  await expect(sessions(page).getByRole("link", { name: /an ordinary session/ })).toBeVisible();
  await expect(toggle(page)).toHaveCount(0);

  await newSession(page);
  await page.getByRole("button", { name: "Agent: Default" }).click();
  await page.getByRole("option", { name: "Log app", exact: true }).click();
  await ask.fill("asked of the app");
  await ask.press("Enter");
  const row = apps(page).getByRole("link", { name: "asked of the app", exact: true });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(sessions(page).getByRole("link", { name: /asked of the app/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Log", exact: true })).toBeVisible();
});

fresh("the editor makes an agent an app; with no view of that key, the app opens on the conversation", async ({ page }) => {
  await page.goto("/#/agents");
  await openAgent(page, "Review");
  await openTab(page, "Settings");
  const settings = page.getByRole("tabpanel", { name: "Settings" });
  const key = settings.getByRole("textbox", { name: "Home view" });
  await expect(settings.getByRole("button", { name: "Save" })).toBeDisabled();
  await key.fill("not a key");
  await key.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "That agent setting isn’t valid." })).toBeVisible();
  await key.fill("board");
  await key.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  await page.goto("/");
  await apps(page).getByRole("button", { name: "Review", exact: true }).click();
  // Review has no extension that offers "board": nothing is made up, the conversation shows.
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Show" })).toHaveCount(0);
});
