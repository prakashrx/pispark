import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";

hostedTest("wide tables, prose and the expanding reply dock share one leading edge", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/#/new");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("A short overview.\n\n| Item | Description |\n| --- | --- |\n| First | A short table with room to grow |\n\nThe last line stays reachable.");
  await page.getByRole("button", { name: "Start session" }).click();
  const main = page.getByRole("main");
  const table = main.getByRole("table");
  const prose = main.locator(".reading-block").first();
  const composer = page.getByRole("form", { name: "Reply to session" });
  await expect(table).toBeVisible();
  const aligned = async () => {
    const boxes = await Promise.all([table.boundingBox(), prose.boundingBox(), composer.boundingBox()]);
    if (boxes.some((box) => !box)) return false;
    const [t, p, c] = boxes;
    return Math.abs(t!.x - p!.x) < 2 && Math.abs(t!.x - c!.x) < 2 && t!.width > c!.width;
  };
  await expect.poll(aligned).toBe(true);
  const details = page.getByRole("button", { name: "Details", exact: true });
  await details.click();
  await expect.poll(aligned).toBe(true);
  const reply = page.getByRole("textbox", { name: "Reply to session", exact: true });
  await reply.fill(Array.from({ length: 20 }, (_, i) => "Expanded draft line " + i).join("\n"));
  await expect.poll(async () => await main.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
