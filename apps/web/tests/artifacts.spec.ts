import { expect } from "@playwright/test";
import { hostedTest } from "./isolated-host";

/** A 2×2 red PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
  "base64",
);

hostedTest("Details lists the session's files as artifacts; each opens beside the conversation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(page.getByRole("button", { name: "Start session" })).not.toHaveAttribute("aria-disabled", "true");
  await ask.click();
  await ask.pressSequentially("Here are my notes ");
  await page.locator('form[aria-label="New session"] input[type="file"]').setInputFiles([
    { name: "shot.png", mimeType: "image/png", buffer: PNG },
    { name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from("# Trip plan\n\n- Day 1: **Grasmere**") },
  ]);
  await ask.press("Enter");
  await expect(page.locator(".user-bubble").first()).toBeVisible();

  const details = page.getByRole("complementary", { name: "Details" });
  const artifacts = details.getByRole("list", { name: "Artifacts" });
  await expect(artifacts.getByRole("button")).toHaveCount(2);
  await expect(artifacts.getByRole("button", { name: /^plan\.md/ })).toContainText("uploaded");
  await expect(artifacts.getByRole("button", { name: /^shot\.png/ }).locator("img")).toBeVisible();

  // Markdown opens rendered, in the side panel, with Back to Details.
  await artifacts.getByRole("button", { name: /^plan\.md/ }).click();
  const file = page.getByRole("complementary", { name: "File" });
  await expect(file.getByRole("heading", { name: "Trip plan" })).toBeVisible();
  await expect(file.locator("strong", { hasText: "Grasmere" })).toBeVisible();
  await expect(file.getByRole("link", { name: "Download" })).toHaveAttribute("download", "plan.md");
  await file.getByRole("button", { name: "Back to Details" }).click();
  await artifacts.getByRole("button", { name: /^shot\.png/ }).click();
  await expect(file.getByRole("img", { name: "shot.png" })).toBeVisible();
});
