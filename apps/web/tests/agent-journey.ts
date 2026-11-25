import { expect, type Page } from "@playwright/test";

/** From the Agents page: create an agent and land on its page. */
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

/** On an agent's page (or a session's agent, inside `within`): open one of its tabs. */
export async function openTab(page: Page, name: string, within = page.locator("body")) {
  const tab = within.getByRole("tab", { name: new RegExp(`^${name}`) });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** An item in a tab's list, by name: its row says where it comes from and what it's for. */
export const listed = (page: Page, tab: string, name: string) =>
  page.getByRole("navigation", { name: tab }).getByRole("button", { name: new RegExp(`^/?${name}\\b`) });

/** On an agent's page: create an instruction of this agent's own, with this text. */
export async function addInstruction(page: Page, text: string, name = "own") {
  await openTab(page, "Instructions");
  await page.getByRole("tabpanel").getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Name it", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Name the instruction" });
  await field.fill(name);
  await field.press("Enter");
  await page.getByRole("textbox", { name: `${name}, Markdown` }).fill(text);
  await page.getByRole("button", { name: "Only this agent", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(listed(page, "Instructions", name)).toContainText("Only this agent");
}

/** Open an agent from the Agents page (or from its page, via All agents). */
export async function openAgent(page: Page, name: string) {
  const all = page.getByRole("link", { name: "All agents" });
  if (await all.isVisible()) await all.click();
  await page.getByRole("main").getByRole("link", { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}
