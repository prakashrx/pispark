import { expect, type Page } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

/** Starts a session from the New session screen and waits for the local model's answer. */
async function start(page: Page, text: string) {
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(page.getByRole("button", { name: "Start session" })).not.toHaveAttribute("aria-disabled", "true");
  await ask.fill(text);
  await ask.press("Enter");
  await expect(page).toHaveURL(/#\/s\/.+/);
  await expect(page.getByText(`local:${text}`, { exact: true })).toBeVisible();
}

const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

test("phone: the session list is the first screen, and each screen goes back to it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const list = page.getByRole("main", { name: "Sessions" });
  await expect(list.getByText("No sessions yet")).toBeVisible();
  // The three destinations are a bar at the bottom.
  const bar = page.locator(".foot.bar");
  for (const name of ["Agents", "Background", "Settings"]) await expect(bar.getByRole("link", { name })).toBeVisible();
  expect((await bar.boundingBox())!.y + (await bar.boundingBox())!.height).toBeCloseTo(844, 0);

  await list.getByRole("link", { name: "New session" }).first().click();
  await expect(page.getByRole("heading", { name: "New session", level: 1 })).toBeVisible();
  // On a phone the composer stays at the bottom, under the thumb.
  const composer = (await page.getByRole("form", { name: "New session" }).boundingBox())!;
  expect(composer.y).toBeGreaterThan(844 / 2);
  await start(page, "phone shell check");
  expect(await scrollsSideways(page)).toBe(false);

  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("main", { name: "Sessions" }).getByRole("link", { name: "phone shell check" })).toBeVisible();
  await page.getByRole("link", { name: "phone shell check" }).click();
  await expect(page.getByText("local:phone shell check", { exact: true })).toBeVisible();
  await page.goBack();

  // Settings: the list of sections, each its own screen with back to the list.
  await page.locator(".foot.bar").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /Providers & models/ }).click();
  await expect(page.getByRole("heading", { name: "Providers & models", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole("link", { name: /Remote access/ })).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
});

test("tablet: the sidebar is a drawer that closes on a choice or Escape and returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);
  await start(page, "tablet drawer check");

  const menu = page.getByRole("button", { name: "Open sessions" });
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "Sessions" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();

  await menu.click();
  await drawer.getByRole("link", { name: "Background" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/#\/background$/);
  await menu.click();
  await drawer.getByRole("link", { name: "tablet drawer check" }).click();
  await expect(page.getByText("local:tablet drawer check", { exact: true })).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
});

test("desktop: the sidebar stays beside every screen, hides and comes back, and marks where you are", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  expect((await sidebar.boundingBox())!.width).toBe(272);
  await start(page, "desktop shell check");
  await expect(sidebar.getByRole("link", { name: "desktop shell check" })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle("PiSpark — desktop shell check");

  for (const [name, heading] of [
    ["Agents", "Agents"],
    ["Background", "Background"],
    ["Settings", "Theme"],
  ]) {
    await sidebar.getByRole("link", { name, exact: true }).click();
    await expect(sidebar.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    await expect(page.getByRole("main")).toBeFocused();
  }
  // Only one message box exists, and only on a session or the New session screen.
  await expect(page.getByRole("textbox", { name: "Ask anything", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(sidebar).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show sidebar" })).toBeFocused();
  await page.keyboard.press("Control+b");
  await expect(sidebar).toBeVisible();

  // Search finds a session by name, wherever it is listed.
  await sidebar.getByRole("searchbox", { name: "Search sessions" }).fill("shell");
  await expect(sidebar.getByText("Results")).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "desktop shell check" })).toBeVisible();
  await sidebar.getByRole("searchbox", { name: "Search sessions" }).fill("nothing like it");
  await expect(sidebar.getByText("No session matches “nothing like it”.")).toBeVisible();
});
