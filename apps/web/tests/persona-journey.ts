import { expect, type Page } from "@playwright/test";

/** From the Personas page: create a persona and land in its editor. */
export async function createPersona(page: Page, name: string, base?: string) {
  await page.getByRole("button", { name: "New persona", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  if (base) {
    await page.getByRole("button", { name: /^Builds on:/ }).click();
    await page.getByRole("option", { name: base, exact: true }).click();
  }
  await page.getByRole("button", { name: "Create persona", exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

/** In the editor: add an instruction with this text. */
export async function addInstruction(page: Page, text: string, name = "local") {
  await page.getByRole("button", { name: "Add instruction", exact: true }).click();
  const form = page.getByRole("form", { name: "Add instruction" });
  await form.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await form.getByRole("textbox", { name: "Text", exact: true }).fill(text);
  await form.getByRole("button", { name: "Add instruction", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
}

/** Open a persona from the Personas page (or from its editor, via All personas). */
export async function openPersona(page: Page, name: string) {
  const all = page.getByRole("button", { name: "All personas" });
  if (await all.isVisible()) await all.click();
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}
