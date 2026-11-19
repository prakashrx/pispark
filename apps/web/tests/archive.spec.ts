import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { newSession } from "./ask";

// Each test gets its own data folder.
const fresh = hostedTest;

const sessions = (page: Page) => page.getByRole("navigation", { name: "Sessions" });
const archivedLink = (page: Page) => sessions(page).getByRole("link", { name: /^Archived \d+$/ });
const archived = (page: Page) => page.getByRole("list", { name: "Archived sessions" });
const sessionLink = (page: Page, name: string) => sessions(page).getByRole("link", { name: new RegExp(name) });

async function ask(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  if (!(await box.count())) await newSession(page);
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
  // (The row's actions fade in together: Rename and Archive.)
  await expect(archive.locator("xpath=..")).toHaveCSS("opacity", "0");
  await sessionLink(page, "second session").hover();
  await expect(archive.locator("xpath=..")).toHaveCSS("opacity", "1");
  await archive.click();
  await expect(sessionLink(page, "second session")).toHaveCount(0);
  await expect(archivedLink(page)).toHaveAccessibleName("Archived 1");
  // A toast says so, with Undo, which puts it back; archiving again leaves it archived.
  const toast = page.getByRole("status").filter({ hasText: "Archived “second session”" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(sessionLink(page, "second session")).toHaveCount(1);
  await expect(archivedLink(page)).toHaveCount(0);
  await sessionLink(page, "second session").hover();
  await archive.click();
  await expect(sessionLink(page, "second session")).toHaveCount(0);
  await expect(archivedLink(page)).toHaveAccessibleName("Archived 1");
  // The open session was another one: it stays open.
  await expect(page.getByText("local:third session", { exact: true })).toBeVisible();

  // By keyboard: Tab from a session's link reaches its Archive button, which shows. Archiving the open
  // session closes it, and focus moves to the next session in the list.
  await sessionLink(page, "third session").focus();
  await page.keyboard.press("Tab");
  await expect(sessions(page).getByRole("button", { name: "Rename third session" })).toBeFocused();
  await page.keyboard.press("Tab");
  const third = sessions(page).getByRole("button", { name: "Archive third session" });
  await expect(third).toBeFocused();
  await expect(third.locator("xpath=..")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  await expect(sessionLink(page, "third session")).toHaveCount(0);
  await expect(sessionLink(page, "first session")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1, name: "New session" })).toBeVisible();
  await expect(archivedLink(page)).toHaveAccessibleName("Archived 2");

  // Archived is its own screen, reached by keyboard; Restore puts a session back in the list.
  await archivedLink(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Archived" })).toBeVisible();
  await expect(archivedLink(page)).toHaveAttribute("aria-current", "page");
  await expect(archived(page).getByRole("listitem")).toHaveCount(2);

  // Delete asks first in a dialog: Escape and Cancel keep it, with focus back on Delete; Delete removes it.
  const remove = archived(page).getByRole("button", { name: "Delete third session" });
  const confirm = page.getByRole("dialog", { name: "Delete this session?" });
  const cancel = confirm.getByRole("button", { name: "Cancel" });
  // Live updates can show the restored session before the browser receives the command response.
  let acknowledge!: () => void;
  const restoring = new Promise<void>((resolve) => { acknowledge = resolve; });
  await page.route("**/api/commands", async (route) => {
    if (route.request().postDataJSON().type !== "restore") return route.continue();
    const response = await route.fetch();
    await restoring;
    await route.fulfill({ response });
  });
  try {
    await archived(page).getByRole("button", { name: "Restore second session" }).click();
    await expect(sessionLink(page, "second session")).toBeVisible();
    await expect(archivedLink(page)).toHaveAccessibleName("Archived 1");
    await expect(archived(page).getByRole("listitem")).toHaveCount(1);
    await remove.click();
    await expect(cancel).toBeFocused();
    const refreshed = page.waitForResponse((res) => res.url().endsWith("/api/sessions?archived") && res.ok());
    acknowledge();
    await refreshed;
    await cancel.click();
    await expect(remove).toBeFocused();
  } finally {
    acknowledge();
  }

  await remove.click();
  await expect(confirm.getByText("“third session” and its messages are deleted from this computer. This can’t be undone.")).toBeVisible();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await confirm.getByRole("button", { name: "Delete session", exact: true }).click();
  await expect(archivedLink(page)).toHaveCount(0);
  await expect(page.getByText("Nothing archived.", { exact: false })).toBeVisible();
  const left = await page.request.get("/api/sessions?archived");
  expect((await left.json()).sessions).toEqual([]);

  // On a phone the list is the first screen; Archived opens from it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await sessionLink(page, "first session").hover();
  await sessions(page).getByRole("button", { name: "Archive first session" }).click();
  await archivedLink(page).click();
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
