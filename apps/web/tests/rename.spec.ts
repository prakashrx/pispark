import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { newSession } from "./ask";

async function ask(page: Page, text: string) {
  await newSession(page);
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByText(`local:${text}`, { exact: true })).toBeVisible();
}
const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });

hostedTest("a session is renamed in place from the pencil beside its title; Escape keeps the old name", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await ask(page, "rename me later");

  // The pencil turns the title into a field with the name selected; typing replaces it, Enter saves.
  const pencil = page.getByRole("banner").getByRole("button", { name: "Rename rename me later" });
  await pencil.click();
  const field = page.getByRole("banner").getByRole("textbox", { name: "Name" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("rename me later");
  await page.keyboard.type("Quarterly notes");
  await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0);
  await expect(heading(page, "Quarterly notes")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Quarterly notes/ }).first()).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Rename Quarterly notes" })).toBeFocused();

  // Escape keeps the name; an empty name changes nothing.
  await page.getByRole("banner").getByRole("button", { name: "Rename Quarterly notes" }).click();
  await page.keyboard.type("Not this");
  await page.keyboard.press("Escape");
  await expect(heading(page, "Quarterly notes")).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "Rename Quarterly notes" }).click();
  await field.fill("  ");
  await page.keyboard.press("Enter");
  await expect(heading(page, "Quarterly notes")).toBeVisible();

  // The name is the server's: it stays after a reload.
  await page.reload();
  await expect(heading(page, "Quarterly notes")).toBeVisible();
});

hostedTest("a session is renamed in place from its row in the list, and from ⋯ Rename", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await ask(page, "row rename");
  const row = page.locator(".session-row", { has: page.getByRole("link", { name: /^row rename/ }) });
  await row.hover();
  await row.getByRole("button", { name: "Rename row rename" }).click();
  const field = page.getByRole("navigation", { name: "Sessions" }).getByRole("textbox", { name: "Name" });
  await expect(field).toBeFocused();
  await field.fill("From the list");
  await field.press("Enter");
  await expect(page.getByRole("link", { name: /^From the list/ }).first()).toBeVisible();
  await expect(heading(page, "From the list")).toBeVisible();

  // ⋯ → Rename edits the title in place too.
  await page.getByRole("button", { name: "Session actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const title = page.getByRole("banner").getByRole("textbox", { name: "Name" });
  await expect(title).toBeFocused();
  await title.fill("From the menu");
  await title.press("Enter");
  await expect(heading(page, "From the menu")).toBeVisible();
});

hostedTest("on a phone, the pencil is in the header and the long-press sheet offers Rename", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await ask(page, "phone rename");
  await page.getByRole("banner").getByRole("button", { name: "Rename phone rename" }).click();
  const field = page.getByRole("banner").getByRole("textbox", { name: "Name" });
  await field.fill("On the go");
  await field.press("Enter");
  await expect(heading(page, "On the go")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

  // On the list, a long press (a right-click here) opens the row's sheet: Rename edits the row in place.
  await page.getByRole("link", { name: "Back" }).click();
  await page.getByRole("link", { name: /^On the go/ }).first().click({ button: "right" });
  await page.getByRole("dialog", { name: "On the go" }).getByRole("button", { name: "Rename" }).click();
  const row = page.getByRole("navigation", { name: "Sessions" }).getByRole("textbox", { name: "Name" });
  await expect(row).toBeFocused();
  await row.fill("Renamed on the list");
  await row.press("Enter");
  await expect(page.getByRole("link", { name: /^Renamed on the list/ }).first()).toBeVisible();
});
