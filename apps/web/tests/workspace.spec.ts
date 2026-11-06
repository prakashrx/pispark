import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { addPrompt, createPersona, openPersona } from "./persona-journey";
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

test("four source pages render locally without errors or external requests", async ({
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
      !request.url().includes("/events") &&
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
    ["workspace", "Start a chat|Test-only deterministic"],
    ["settings", "General"],
    ["persona", "Personas"],
    ["sources", "Sources"],
  ]) {
    await page.goto(`/#/${route}`);
    await expect(
      page.getByRole("heading", { name: new RegExp(heading), level: 1 }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (await page.locator(".material-symbols-outlined").count()) {
      expect(
        await page.evaluate(() =>
          document.fonts.check('24px "Material Symbols Outlined"'),
        ),
      ).toBe(true);
    }
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

test("keyboard selectors, independent draft composers and sidebar navigation", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Ask anything" })
    .fill("An unsent question");
  await page
    .getByRole("textbox", { name: /Reply to chat/ })
    .fill("An unsent follow-up");
  await expect(
    page.getByRole("button", { name: "Style", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add context", exact: true }),
  ).toHaveCount(0);
  const folder = page.getByRole("button", { name: "Folder: workspace" });
  await folder.click();
  await page.getByRole("combobox", { name: "Search Folder" }).fill("notes");
  await capture(page, info, "folder-popup");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Folder: notes" }),
  ).toBeFocused();
  await page
    .getByRole("button", {
      name: "Persona: No persona",
    })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "Persona: No persona",
    }),
  ).toBeFocused();
  await page.getByRole("button", { name: /^Chats/ }).click();
  await page.getByRole("textbox", { name: /Ask anything/ }).focus();
  await page.keyboard.press("Control+b");
  await expect(page.getByRole("complementary")).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).focus();
  await page.keyboard.press("Control+b");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "General", level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .last()
    .click();
  await expect(page.getByRole("heading", { name: "Personas" })).toBeVisible();
  await createPersona(page, "Keyboard writer");
  await addPrompt(page, "Local instructions");
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Personas", exact: true }),
  ).toBeVisible();
  await openPersona(page, "Keyboard writer");
  await expect(
    page.getByRole("heading", { name: "Keyboard writer" }),
  ).toBeVisible();
});

test("Sources is truthfully unavailable and only navigates to real Personas without connection requests", async ({
  page,
  baseURL,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith(new URL(baseURL!).origin) &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("/#/sources");
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Source connections aren’t available yet. You can use local personas and skills in Personas.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Add Source|Sync|Remove/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/local-review-kit|official registry|active/i),
  ).toHaveCount(0);
  await page
    .getByRole("main")
    .getByRole("link", { name: "Manage personas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Personas", exact: true }),
  ).toBeVisible();
  expect(external).toEqual([]);
});

test("narrow pages reflow without clipping and popup/modal remain keyboard usable", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["workspace", "settings", "persona", "sources"]) {
    await page.goto(`/#/${route}`);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await capture(page, info, `mobile-${route}`);
  }
  await page.getByRole("button", { name: "Folder: workspace" }).click();
  await expect(
    page.getByRole("combobox", { name: "Search Folder" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
});
