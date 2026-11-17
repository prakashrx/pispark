import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { folderButton, otherFolder, otherFolderLabel } from "./ask";
import { hostedTest } from "./isolated-host";
import { addInstruction, createAgent, openAgent } from "./agent-journey";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

async function capture(page: Page, info: TestInfo, name: string) {
  const directory = process.env.PISPARK_EVIDENCE_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: directory
      ? resolve(directory, `${name}.png`)
      : info.outputPath(`${name}.png`),
    fullPage: !name.includes("modal"),
    animations: "disabled",
  });
}

hostedTest("every screen renders locally without errors or external requests", async ({
  page,
  baseURL,
}, info) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (
      !request.url().includes("/live") &&
      request.failure()?.errorText !== "net::ERR_ABORTED"
    )
      errors.push(`Request failed: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on("request", (request) => {
    if (
      !request.url().startsWith(`${new URL(baseURL!).origin}/`) &&
      !request.url().startsWith("data:")
    )
      external.push(request.url());
  });
  for (const [route, heading] of [
    ["new", "New session"],
    ["settings", "Settings"],
    ["agents", "Agents"],
    ["background", "Background"],
    ["archived", "Archived"],
  ]) {
    await page.goto(`/#/${route}`);
    await expect(
      page.getByRole("heading", { name: new RegExp(heading), level: 1 }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.fonts.check('15px "Inter Variable"')),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await capture(page, info, `desktop-${route}`);
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

hostedTest("keyboard selectors, independent draft composers and sidebar navigation", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Ask anything" })
    .fill("An unsent question");
  // No session is open yet, so there is no reply composer to type into.
  await expect(
    page.getByRole("textbox", { name: /Reply to session/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Style", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add context", exact: true }),
  ).toHaveCount(0);
  await folderButton(page).click();
  await page.getByRole("textbox", { name: "Another folder" }).fill(otherFolder);
  await capture(page, info, "folder-popup");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: otherFolderLabel, exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", {
      name: "Agent: Default",
    })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "Agent: Default",
    }),
  ).toBeFocused();
  await page.getByRole("textbox", { name: /Ask anything/ }).focus();
  await page.keyboard.press("Control+b");
  await expect(page.getByRole("complementary")).toBeVisible();
  await page.getByRole("button", { name: "Hide sidebar" }).focus();
  await page.keyboard.press("Control+b");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Theme", level: 2 }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Agents", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await createAgent(page, "Keyboard writer");
  await addInstruction(page, "Local instructions");
  await page.getByRole("link", { name: "Background", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Background", level: 1 })).toBeVisible();
  // Back returns to where you were: the agent's editor.
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Keyboard writer", level: 1 }),
  ).toBeVisible();
  await openAgent(page, "Keyboard writer");
  await expect(
    page.getByRole("heading", { name: "Keyboard writer" }),
  ).toBeVisible();
});

test("narrow pages reflow without clipping and popup/modal remain keyboard usable", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["settings", "agents", "background", "new"]) {
    await page.goto(`/#/${route}`);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await capture(page, info, `mobile-${route}`);
  }
  await folderButton(page).click();
  await expect(
    page.getByRole("combobox", { name: "Search Working folder" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // On a phone the picker is a bottom sheet across the screen, with its title.
  const sheet = page.locator("[data-selector-popup]");
  await sheet.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.width)).toBe(390);
  expect(Math.round(box.y + box.height)).toBe(844);
  await expect(sheet.getByText("Working folder", { exact: true })).toBeVisible();
  // A tap outside closes it; Escape closes it and focus goes back to the control.
  await page.mouse.click(195, 40);
  await expect(sheet).toHaveCount(0);
  await folderButton(page).click();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(folderButton(page)).toBeFocused();
});
