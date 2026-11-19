import { expect } from "@playwright/test";
import { hostedTest as test } from "./isolated-host";

test.use({ viewport: { width: 412, height: 840 }, hasTouch: true, isMobile: true });

test("Return adds a line, one tap sends, and Details preserves the reading position", async ({ page }) => {
  await page.goto("/#/new");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill("First line");
  await box.press("End");
  await box.press("Enter");
  await page.keyboard.insertText("Second line");
  await expect(page).toHaveURL(/#\/new$/);
  expect(await box.innerText()).toMatch(/First line\n+Second line/);
  await page.getByRole("button", { name: "Start session" }).tap();
  await expect(page.locator('[data-purpose="user-turn"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  const reply = page.getByRole("textbox", { name: "Reply to session", exact: true });
  await reply.fill(Array.from({ length: 55 }, (_, i) => "Reading line " + i).join("\n"));
  await page.getByRole("button", { name: "Send message" }).tap();
  await expect(page.locator('[data-purpose="user-turn"]')).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  const main = page.locator("main");
  await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeGreaterThan(600);
  await main.evaluate(el => { el.scrollTop = 240; });
  await expect(page.getByRole("button", { name: /latest/i })).toBeVisible();
  await page.getByRole("button", { name: "Details", exact: true }).tap();
  await page.goBack();
  await expect.poll(() => main.evaluate(el => el.scrollTop)).toBe(240);
});

test("a draft upload has a tappable removal control and keeps its origin after removal", async ({ page }) => {
  await page.goto("/#/new");
  await page.getByRole("textbox", { name: "Ask anything", exact: true }).fill("Draft attachment test");
  await page.getByRole("button", { name: "Start session" }).tap();
  const composer = page.getByRole("form", { name: "Reply to session" });
  await composer.locator('input[type="file"]').setInputFiles({
    name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("attachment"),
  });
  const chip = composer.locator(".rich-token");
  await expect(chip).toHaveAttribute("data-state", "ready");
  const remove = chip.locator("button");
  const target = await remove.boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(32);
  expect(target!.width).toBeGreaterThanOrEqual(32);
  await page.touchscreen.tap(target!.x + target!.width / 2, target!.y + target!.height - 2);
  await expect(chip).toHaveCount(0);
  const id = new URL(page.url()).hash.split("/")[2];
  const response = await page.request.get(`/api/sessions/${id}/attachments`);
  expect((await response.json()).files).toContainEqual(expect.objectContaining({ name: "draft.txt", by: "you" }));
});
