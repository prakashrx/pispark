import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { newSession } from "./ask";

async function ask(page: Page, text: string) {
  await newSession(page);
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(text);
  await box.press("Enter");
}
async function reply(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Reply to session" });
  await box.fill(text);
  await box.press("Enter");
}

hostedTest("a message edited and sent again keeps the earlier version; versions switch; a fork starts at a reply", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await ask(page, "first");
  await expect(page.getByText("local:first", { exact: true })).toBeVisible();
  await reply(page, "second");
  await expect(page.getByText("local:second", { exact: true })).toBeVisible();

  // Edit: the reply box takes the message; Escape puts back what was there.
  const second = page.locator('[data-purpose="user-turn"]').filter({ has: page.getByText("second", { exact: true }) });
  await second.hover();
  await second.getByRole("button", { name: "Edit message" }).click();
  const box = page.getByRole("textbox", { name: "Reply to session" });
  await expect(box).toBeFocused();
  await expect(box).toHaveText("second");
  await expect(page.getByRole("status").filter({ hasText: "Editing your message" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({ hasText: "Editing your message" })).toHaveCount(0);
  await expect(box).toHaveText("");

  await second.hover();
  await second.getByRole("button", { name: "Edit message" }).click();
  await box.fill("second, edited");
  await box.press("Enter");
  await expect(page.getByText("local:second, edited", { exact: true })).toBeVisible();
  await expect(page.getByText("local:second", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Version 2 of 2")).toBeVisible();

  // The earlier version and what followed it are a click away, by keyboard too.
  await page.getByRole("button", { name: "Previous version" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("local:second", { exact: true })).toBeVisible();
  await expect(page.getByText("local:second, edited", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Version 1 of 2")).toBeVisible();

  // Fork from the first reply: a new session that ends with it.
  const before = page.url();
  await page.locator('[data-purpose="turn"]').first().getByRole("button", { name: "Fork from here" }).click();
  await expect.poll(() => page.url()).not.toBe(before);
  await expect(page.getByText("local:first", { exact: true })).toBeVisible();
  await expect(page.getByText("local:second", { exact: true })).toHaveCount(0);
});
