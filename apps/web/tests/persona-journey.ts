import {
  expect,
  type Page,
  type TestInfo,
  type APIRequestContext,
} from "@playwright/test";
export async function collection(page: Page) {
  if (!page.url().endsWith("#/persona")) await page.goto("/#/persona");
  await expect(
    page.getByRole("main", { name: "Persona management" }),
  ).toBeVisible();
  const fileDialog = page.getByRole("region", {
    name: "Edit file",
    exact: true,
  });
  if (await fileDialog.count()) {
    const load = fileDialog.getByRole("button", {
      name: "Load file",
      exact: true,
    });
    if (await load.count()) await expect(load).toBeEnabled();
    await page.keyboard.press("Escape");
  }
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Personas", exact: true }),
  ).toBeVisible();
}
export async function openPersona(page: Page, name: string) {
  await collection(page);
  await page
    .getByRole("textbox", { name: "Search personas", exact: true })
    .fill(name);
  await page
    .getByRole("main")
    .getByRole("button")
    .filter({ has: page.locator("span.font-medium", { hasText: name }) })
    .first()
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
export async function createPersona(page: Page, name: string) {
  await collection(page);
  await page.getByRole("button", { name: "New persona", exact: true }).click();
  const dialog = page.getByRole("region", { name: "New persona", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "Name", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await dialog
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
export async function action(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Persona actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
export async function metadata(page: Page, description: string) {
  await action(page, "Edit name and description");
  const dialog = page.getByRole("region", {
    name: "Edit name and description",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Description", exact: true })
    .fill(description);
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
}
export async function save(page: Page) {
  if (
    await page.getByRole("region", { name: "Edit file", exact: true }).count()
  )
    await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
}
// Explicit isolated legacy fixture setup, not a new linked-file UI workflow.
export async function addFile(page: Page, name = "rules.md") {
  const title = await page
    .getByRole("main")
    .getByRole("heading", { level: 1 })
    .innerText();
  const request = page.request;
  const ref = await refFor(request, title);
  const read = await (
    await request.post("/api/personas/read", { data: { ref } })
  ).json();
  expect(
    (
      await request.post("/api/personas/instruction", {
        data: {
          ref,
          path: name,
          expectedRevision: null,
          text: "Legacy fixture contents",
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/personas/save", {
        data: {
          ref,
          expectedRevision: read.revision,
          definition: {
            ...read.definition,
            instructions: [
              ...(read.definition.instructions ?? []),
              { id: "rules", file: name },
            ],
          },
        },
      })
    ).ok(),
  ).toBe(true);
  await action(page, "Reload saved version");
  await expect(
    page
      .locator("[data-instructions] .prompt-text")
      .filter({ hasText: "Legacy fixture contents" }),
  ).toBeVisible();
}
export async function addPrompt(page: Page, text: string) {
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Add prompt", exact: true });
  await dialog
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill(text);
  await dialog.getByRole("button", { name: "Add prompt", exact: true }).click();
}
export async function editFile(page: Page, n = 1) {
  await resourceAction(page, "Instruction", n, "Edit file");
  const dialog = page.getByRole("region", { name: "Edit file", exact: true });
  await dialog
    .locator("summary")
    .filter({ hasText: /^Edit file/ })
    .click();
  const load = dialog.getByRole("button", { name: "Load file", exact: true });
  if (
    (await load.count()) &&
    !(await dialog.getByRole("textbox", { name: /^File text:/ }).count())
  )
    await load.click();
}
export async function resourceAction(
  page: Page,
  kind: "Instruction" | "Skill",
  n: number,
  label: string,
) {
  await page
    .getByRole("button", {
      name: `${kind === "Instruction" ? "Prompt" : kind} ${n} actions`,
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
export async function reference(
  page: Page,
  n: number,
  value: string,
  kind: "Instruction" | "Skill" = "Instruction",
) {
  await resourceAction(page, kind, n, "Advanced settings");
  const dialog = page.getByRole("region", {
    name: "Advanced settings",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Reference name", exact: true })
    .fill(value);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
}
export async function addParent(page: Page, name: string) {
  // Picking a persona adds it immediately; there is no confirm step.
  await page
    .getByRole("button", { name: "Reuse a persona", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Search Reuse a persona", exact: true })
    .fill(name);
  await page.getByRole("option", { name, exact: true }).click();
  await expect(
    page.getByRole("article", { name, exact: true }),
  ).toBeVisible();
}
export async function refFor(request: APIRequestContext, name: string) {
  const catalog = await (await request.get("/api/personas")).json();
  const found = catalog.personas.find((p: { name: string }) => p.name === name);
  expect(found).toBeTruthy();
  return found.ref;
}
export async function capture(
  page: Page,
  info: TestInfo,
  surface: string,
  widths = [390, 1920, 3840],
) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${surface}-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
}
