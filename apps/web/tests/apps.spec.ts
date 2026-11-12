import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { openPersona } from "./persona-journey";

// Each test gets its own data folder. "Log app" is an app persona: its home is the Log view its extension offers.
const fresh = hostedTest;

const apps = (page: Page) => page.getByRole("navigation", { name: "Apps" });
const chats = (page: Page) => page.getByRole("navigation", { name: "Chats" });
const toggle = (page: Page) => apps(page).getByRole("button", { name: "Sessions of Log app" });
const started = (page: Page) => apps(page).getByRole("link", { name: /^Started / });

fresh("an app is opened from the sidebar on its home view, and its sessions are listed under it", async ({ page }) => {
  await page.goto("/");
  const app = apps(page).getByRole("link", { name: "Log app", exact: true });
  await expect(app).toBeVisible();
  // It has no session yet, so there is nothing to unfold.
  await expect(toggle(page)).toHaveCount(0);

  // By keyboard. No message is sent: the session is made and shows the app's home view.
  await app.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main", { name: "Log" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Log app", exact: true })).toBeVisible();
  const show = page.getByRole("radiogroup", { name: "Show" });
  await expect(show.getByRole("radio", { name: "Log" })).toBeChecked();
  // It is listed under its app, which is open around it, and not among the chats.
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(started(page)).toHaveCount(1);
  await expect(started(page)).toHaveAttribute("aria-current", "page");
  await expect(chats(page)).toContainText("No chats yet.");

  // Any session shows as a conversation, and that choice is kept for it.
  await show.getByRole("radio", { name: "Log" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("main", { name: "Chat conversation" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("main", { name: "Chat conversation" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Log app", exact: true })).toBeVisible();

  // New session makes a second one, which opens on the home view again.
  await apps(page).getByRole("button", { name: "New session" }).click();
  await expect(started(page)).toHaveCount(2);
  await expect(page.getByRole("main", { name: "Log" })).toBeVisible();
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

  await page.setViewportSize({ width: 390, height: 844 });
  await toggle(page).click();
  await expect(started(page)).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

fresh("chats stay in the chat list; an app started from Ask is listed under the app by its title", async ({ page }) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("an ordinary chat");
  await ask.press("Enter");
  await expect(chats(page).getByRole("link", { name: /an ordinary chat/ })).toBeVisible();
  await expect(toggle(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Persona: Default" }).click();
  await page.getByRole("option", { name: "Log app", exact: true }).click();
  await ask.fill("asked of the app");
  await ask.press("Enter");
  const row = apps(page).getByRole("link", { name: "asked of the app", exact: true });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(chats(page).getByRole("link", { name: /asked of the app/ })).toHaveCount(0);
  await expect(page.getByRole("main", { name: "Log" })).toBeVisible();
});

fresh("the editor makes a persona an app; with no view of that key, the app opens on the conversation", async ({ page }) => {
  await page.goto("/#/persona");
  await openPersona(page, "Review");
  const form = page.getByRole("form", { name: "Home view" });
  const key = form.getByRole("textbox", { name: "Home view" });
  await expect(form.getByRole("button", { name: "Save" })).toHaveAttribute("aria-disabled", "true");
  await key.fill("not a key");
  await key.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "That persona setting isn’t valid." })).toBeVisible();
  await key.fill("board");
  await key.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  await page.goto("/");
  await apps(page).getByRole("link", { name: "Review", exact: true }).click();
  // Review has no extension that offers "board": nothing is made up, the conversation shows.
  await expect(page.getByRole("main", { name: "Chat conversation" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Review", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Show" })).toHaveCount(0);
});
