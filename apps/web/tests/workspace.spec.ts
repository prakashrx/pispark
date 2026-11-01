import { test, expect, type Page, type TestInfo } from "@playwright/test";
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
    errors.push(`Request failed: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on("request", (request) => {
    if (
      !request.url().startsWith(new URL(baseURL!).origin + "/") &&
      !request.url().startsWith("data:")
    )
      external.push(request.url());
  });
  for (const [route, heading] of [
    ["workspace", "Workspace review"],
    ["settings", "General"],
    ["persona", "Developer Persona"],
    ["sources", "Sources 3 active"],
  ]) {
    await page.goto(`/#/${route}`);
    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
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
    .getByRole("textbox", { name: "Ask anything (local draft)" })
    .fill("An unsent question");
  await page
    .getByRole("textbox", { name: /Reply to Workspace/ })
    .fill("An unsent follow-up");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  const persona = page.getByRole("button", { name: "Persona: Developer" });
  await persona.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Persona: General" }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: /^Style:/ })).toHaveCount(0);
  const folder = page.getByRole("button", { name: "Folder: pispark" });
  await folder.click();
  await page.getByRole("combobox", { name: "Search Folder" }).fill("notes");
  await capture(page, info, "folder-popup");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Folder: notes" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Model: balanced" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Model: balanced" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByText("Confirm file change")).toHaveCount(0);
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
  await page.getByRole("link", { name: "Developer", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Developer Persona" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Display Name" })
    .fill("Local developer");
  await page.getByRole("button", { name: "Add Text Prompt" }).click();
  await page
    .getByRole("textbox", { name: "Text Prompt" })
    .fill("Local instructions");
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sources 3 active" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Developer Persona" }),
  ).toBeVisible();
});

test("source modal traps focus, validates drafts, closes and restores focus without connections", async ({
  page,
}, info) => {
  await page.goto("/#/sources");
  const requests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("data:")) requests.push(request.url());
  });
  const add = page.getByRole("button", { name: "Add Source", exact: true });
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add New Source" });
  await expect(
    page.getByRole("textbox", { name: "Source Name" }),
  ).toBeFocused();
  await capture(page, info, "sources-add-modal");
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Marketplace URL" }),
  ).toBeFocused();
  for (let n = 0; n < 14; n++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await add.click();
  await page
    .getByRole("textbox", { name: "Source Name" })
    .fill("local-review-kit");
  await page
    .getByRole("textbox", { name: "Repository URL or Path" })
    .fill("file:///fixture");
  await dialog.getByRole("button", { name: "Add Source", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Source name already exists in this local draft.",
  );
  await page
    .getByRole("button", { name: "Marketplace URL", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Branch or Tag" }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Source Name" })
    .fill("test-registry");
  await page
    .getByRole("textbox", { name: "Marketplace / Registry URL" })
    .fill("https://example.invalid/registry");
  await page
    .getByRole("checkbox", { name: "Check updates on launch" })
    .uncheck();
  await dialog.getByRole("button", { name: "Add Source", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(
    page
      .getByRole("status")
      .getByText("Added local draft; no source connected", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sources 3 active" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Remove test-registry", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "test-registry", exact: true }),
  ).toHaveCount(0);
  expect(requests).toEqual([]);
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
  const sourceTitle = await page
    .getByRole("heading", { name: "local-review-kit" })
    .boundingBox();
  const sourceActions = await page
    .getByRole("button", { name: "Inspect resources" })
    .first()
    .boundingBox();
  expect(sourceActions!.y).toBeGreaterThan(
    sourceTitle!.y + sourceTitle!.height,
  );
  await page.getByRole("button", { name: "Add Source", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, info, "mobile-source-modal");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Add Source", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Folder: pispark" }).click();
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
