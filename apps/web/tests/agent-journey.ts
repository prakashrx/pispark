import { expect, type Page } from "@playwright/test";

/** From the Agents page: create an agent and land in its editor. */
export async function createAgent(page: Page, name: string, base?: string) {
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  if (base) {
    await page.getByRole("button", { name: /^Builds on:/ }).click();
    await page.getByRole("option", { name: base, exact: true }).click();
  }
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

/** In the editor: add an instruction with this text. */
export async function addInstruction(page: Page, text: string, name = "local") {
  await page.getByRole("button", { name: "Add instruction", exact: true }).click();
  const form = page.getByRole("form", { name: "Add instruction" });
  await form.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await form.getByRole("textbox", { name: "Text", exact: true }).fill(text);
  await page.getByRole("dialog", { name: "Add instruction" }).getByRole("button", { name: "Add instruction", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
}

/** Open an agent from the Agents page (or from its editor, via All agents). */
export async function openAgent(page: Page, name: string) {
  const all = page.getByRole("link", { name: "All agents" });
  if (await all.isVisible()) await all.click();
  await page.getByRole("main").getByRole("link", { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}
