import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";

// Each test gets its own data folder.
const fresh = hostedTest;

const chats = (page: Page) => page.getByRole("navigation", { name: "Chats" });
const archivedToggle = (page: Page) => chats(page).getByRole("button", { name: /^Archived \(\d+\)$/ });
const archived = (page: Page) => page.getByRole("list", { name: "Archived chats" });
const chatLink = (page: Page, name: string) => chats(page).getByRole("link", { name: new RegExp(name) });

async function ask(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByText(`local:${text}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
}

fresh("each chat in the sidebar is archived from its row; Archived restores it or deletes it for good", async ({ page }) => {
  await page.goto("/");
  await ask(page, "first chat");
  await ask(page, "second chat");
  await ask(page, "third chat");

  // The Archive button shows when the row is pointed at, and works.
  const archive = chats(page).getByRole("button", { name: "Archive second chat" });
  await expect(archive).toHaveCSS("opacity", "0");
  await chatLink(page, "second chat").hover();
  await expect(archive).toHaveCSS("opacity", "1");
  await archive.click();
  await expect(chatLink(page, "second chat")).toHaveCount(0);
  await expect(archivedToggle(page)).toHaveAccessibleName("Archived (1)");
  // The open chat was another one: it stays open.
  await expect(page.getByText("local:third chat", { exact: true })).toBeVisible();

  // By keyboard: Tab from a chat's link reaches its Archive button, which shows. Archiving the open
  // chat closes it, and focus moves to the next chat in the list.
  await chatLink(page, "third chat").focus();
  await page.keyboard.press("Tab");
  const third = chats(page).getByRole("button", { name: "Archive third chat" });
  await expect(third).toBeFocused();
  await expect(third).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(chatLink(page, "third chat")).toHaveCount(0);
  await expect(chatLink(page, "first chat")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1, name: "New chat" })).toBeVisible();
  await expect(archivedToggle(page)).toHaveAccessibleName("Archived (2)");

  // Archived unfolds by keyboard; Restore puts a chat back in the list.
  await archivedToggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(archivedToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(archived(page).getByRole("listitem")).toHaveCount(2);
  await archived(page).getByRole("button", { name: "Restore second chat" }).click();
  await expect(chatLink(page, "second chat")).toBeVisible();
  await expect(archivedToggle(page)).toHaveAccessibleName("Archived (1)");

  // Delete asks first: Escape and Cancel keep it, with focus back on Delete; Delete removes it.
  const remove = archived(page).getByRole("button", { name: "Delete third chat" });
  await remove.click();
  await expect(archived(page).getByText("Delete permanently? This can’t be undone.")).toBeVisible();
  await expect(archived(page).getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  await remove.click();
  await archived(page).getByRole("button", { name: "Cancel" }).click();
  await expect(remove).toBeFocused();
  await remove.click();
  await archived(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(archivedToggle(page)).toHaveCount(0);
  const left = await page.request.get("/api/sessions?archived");
  expect((await left.json()).sessions).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await chatLink(page, "first chat").hover();
  await chats(page).getByRole("button", { name: "Archive first chat" }).click();
  await archivedToggle(page).click();
  await expect(archived(page).getByRole("button", { name: "Delete first chat" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

fresh("a chat that is working is not archived until it is stopped", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  // The browser host's model holds a prompt that says "hold" until it is stopped.
  await box.fill("hold this one");
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
  // While it works there is nothing to press; once stopped, it can be archived.
  const archive = chats(page).getByRole("button", { name: /^Archive hold this one/ });
  await expect(chats(page).getByRole("link", { name: /hold this one/ })).toBeVisible();
  await expect(archive).toHaveCount(0);
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(archive).toHaveCount(1);
});
