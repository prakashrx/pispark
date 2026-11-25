import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";

hostedTest("prose, a wide table and the expanding reply dock share one column; the table scrolls inside it", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/#/new");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  const columns = Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`);
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const wide = [row(columns), row(columns.map(() => "---")), row(columns.map((_, i) => `column_${i + 1}_unbroken_value`))].join("\n");
  await ask.fill(`A short overview.\n\n${wide}\n\nThe last line stays reachable.`);
  await page.getByRole("button", { name: "Start session" }).click();
  const main = page.getByRole("main");
  // The reply (your message renders its Markdown too, inside its bubble).
  const answer = main.locator("[data-purpose=assistant-turn-stream]");
  const table = answer.getByRole("region", { name: "Table" });
  const prose = answer.locator(".reading-block").first();
  const composer = page.getByRole("form", { name: "Reply to session" });
  await expect(table).toBeVisible();
  const aligned = async () => {
    const boxes = await Promise.all([table.boundingBox(), prose.boundingBox(), composer.boundingBox()]);
    if (boxes.some((box) => !box)) return false;
    const [t, p, c] = boxes;
    const scrolls = await table.evaluate((el) => el.scrollWidth > el.clientWidth);
    return Math.abs(t!.x - p!.x) < 2 && Math.abs(t!.x - c!.x) < 2 && Math.abs(t!.x + t!.width - (c!.x + c!.width)) < 2 && scrolls;
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
