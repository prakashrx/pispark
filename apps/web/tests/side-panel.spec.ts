import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";

hostedTest("the side panel's edge resizes it, by keyboard or pointer, within 360–480 px, and keeps the width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/new");
  const box = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await box.fill("panel width");
  await box.press("Enter");
  await expect(page.getByText("local:panel width", { exact: true })).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Details" });
  const edge = page.getByRole("separator", { name: "Resize panel" });
  await expect(edge).toHaveAttribute("aria-valuenow", "380");
  await edge.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(edge).toHaveAttribute("aria-valuenow", "412");
  expect(Math.round((await panel.boundingBox())!.width)).toBe(412);
  await page.keyboard.press("End");
  await expect(edge).toHaveAttribute("aria-valuenow", "480");
  // Dragged past the narrowest, it stops there.
  const at = (await edge.boundingBox())!;
  await page.mouse.move(at.x + 3, at.y + 200);
  await page.mouse.down();
  await page.mouse.move(at.x + 400, at.y + 200);
  await page.mouse.up();
  await expect(edge).toHaveAttribute("aria-valuenow", "360");
  await page.reload();
  await expect(page.getByRole("separator", { name: "Resize panel" })).toHaveAttribute("aria-valuenow", "360");
});
