import { expect, type Page } from "@playwright/test";
import { hostedTest } from "./isolated-host";
import { newSession } from "./ask";

async function ask(page: Page, text: string) {
  await newSession(page);
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill(text);
  await box.press("Enter");
}
const details = (page: Page) => page.getByRole("complementary", { name: "Details" });

hostedTest("Details changes the session's model between replies, shows its context, and the next reply uses it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await ask(page, "first reply");
  await expect(page.getByText("local:first reply", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).not.toHaveAttribute("aria-disabled", "true");

  // Context: how full the model's window is, in the panel and the status line.
  await expect(details(page).getByText(/% of 100k/)).toBeVisible();
  await expect(details(page).getByRole("meter", { name: "Context used" })).toBeVisible();
  await expect(page.locator(".status-line")).toContainText(/%/);

  // Another model, from the next reply on.
  await details(page).getByRole("button", { name: /^Model/ }).click();
  await page.getByRole("option", { name: /^Second local model/ }).click();
  await expect(page.locator(".status-line")).toContainText("Second local model");
  const reply = page.getByRole("textbox", { name: "Reply to session" });
  await reply.fill("second reply");
  await reply.press("Enter");
  await expect(page.getByText("local:second reply", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".status-line")).toContainText("Second local model");
});

hostedTest("a failed reply's card opens Details on the model", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await ask(page, "provider-error");
  const card = page.getByRole("alert").filter({ hasText: "The run failed" });
  await card.getByRole("button", { name: "Choose another model" }).click();
  await expect(details(page).locator("[data-model-picker] button").first()).toBeFocused();
});
