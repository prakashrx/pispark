import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";

// Each test gets its own data folder.
const fresh = hostedTest;

const sessions = (page: Page) => page.getByRole("navigation", { name: "Sessions" });
const archivedToggle = (page: Page) => sessions(page).getByRole("button", { name: /^Archived \(\d+\)$/ });
const archived = (page: Page) => page.getByRole("list", { name: "Archived sessions" });
const sessionLink = (page: Page, name: string) => sessions(page).getByRole("link", { name: new RegExp(name) });

async function ask(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(text);
  await box.press("Enter");
  await expect(page.getByText(`local:${text}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");
}

fresh("each session in the sidebar is archived from its row; Archived restores it or deletes it for good", async ({ page }) => {
  await page.goto("/");
  await ask(page, "first session");
  await ask(page, "second session");
  await ask(page, "third session");

  // The Archive button shows when the row is pointed at, and works.
  const archive = sessions(page).getByRole("button", { name: "Archive second session" });
  await expect(archive).toHaveCSS("opacity", "0");
  await sessionLink(page, "second session").hover();
  await expect(archive).toHaveCSS("opacity", "1");
  await archive.click();
  await expect(sessionLink(page, "second session")).toHaveCount(0);
  await expect(archivedToggle(page)).toHaveAccessibleName("Archived (1)");
  // The open session was another one: it stays open.
  await expect(page.getByText("local:third session", { exact: true })).toBeVisible();

  // By keyboard: Tab from a session's link reaches its Archive button, which shows. Archiving the open
  // session closes it, and focus moves to the next session in the list.
  await sessionLink(page, "third session").focus();
  await page.keyboard.press("Tab");
  const third = sessions(page).getByRole("button", { name: "Archive third session" });
  await expect(third).toBeFocused();
  await expect(third).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(sessionLink(page, "third session")).toHaveCount(0);
  await expect(sessionLink(page, "first session")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1, name: "New session" })).toBeVisible();
  await expect(archivedToggle(page)).toHaveAccessibleName("Archived (2)");

  // Archived unfolds by keyboard; Restore puts a session back in the list.
  await archivedToggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(archivedToggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(archived(page).getByRole("listitem")).toHaveCount(2);
  await archived(page).getByRole("button", { name: "Restore second session" }).click();
  await expect(sessionLink(page, "second session")).toBeVisible();
  await expect(archivedToggle(page)).toHaveAccessibleName("Archived (1)");

  // Delete asks first: Escape and Cancel keep it, with focus back on Delete; Delete removes it.
  const remove = archived(page).getByRole("button", { name: "Delete third session" });
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
  await sessionLink(page, "first session").hover();
  await sessions(page).getByRole("button", { name: "Archive first session" }).click();
  await archivedToggle(page).click();
  await expect(archived(page).getByRole("button", { name: "Delete first session" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

fresh("a session that is working is not archived until it is stopped", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  // The browser host's model holds a prompt that says "hold" until it is stopped.
  await box.fill("hold this one");
  await box.press("Enter");
  await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
  // While it works there is nothing to press; once stopped, it can be archived.
  const archive = sessions(page).getByRole("button", { name: /^Archive hold this one/ });
  await expect(sessions(page).getByRole("link", { name: /hold this one/ })).toBeVisible();
  await expect(archive).toHaveCount(0);
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(archive).toHaveCount(1);
});
