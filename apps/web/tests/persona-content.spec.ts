import { test, expect } from "@playwright/test";
import {
  action,
  addParent,
  addPrompt,
  capture,
  collection,
  createPersona,
  openPersona,
  refFor,
  resourceAction,
  save,
} from "./persona-journey";

test("continuous authoritative resources, private prompt dialogs and text-only imports survive deliberate navigation", async ({
  page,
  request,
}, info) => {
  const suffix = Date.now().toString(36),
    baseName = `Origin ${suffix}`,
    middleName = `Reuse ${suffix}`,
    name = `Content ${suffix}`;
  const library = await refFor(request, "Test review library");
  const long = Array.from(
    { length: 70 },
    (_, i) => `Line ${i}: plain <b>text</b> and readable instructions.`,
  ).join("\n");
  const base = await (
    await request.post("/api/personas/create", {
      data: {
        definition: {
          schemaVersion: 1,
          name: baseName,
          parents: [library],
          instructions: [
            { id: "instruction-1", text: long },
            { id: "short", text: "A short complete prompt." },
          ],
        },
      },
    })
  ).json();
  await request.post("/api/personas/create", {
    data: {
      definition: { schemaVersion: 1, name: middleName, parents: [base.ref] },
    },
  });
  await page.goto("/#/persona");
  await createPersona(page, name);
  const ref = await refFor(request, name);
  await capture(page, info, "continuous-empty");
  await page.getByRole("button", { name: "Use persona", exact: true }).click();
  await capture(page, info, "reuse-chooser");
  await page.keyboard.press("Escape");
  await addParent(page, middleName);
  await expect(page.locator("[data-instructions]")).toContainText(
    `From ${baseName}`,
  );
  await expect(page.locator("[data-skills]")).toContainText(
    "From Test review library",
  );
  await expect(page.locator("[data-instructions]")).not.toContainText(
    `From ${middleName}`,
  );
  await expect(
    page.locator("[data-instructions] .prompt-text").last(),
  ).toHaveText("A short complete prompt.");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Back to personas", exact: true }),
  ).toHaveCount(0);
  await capture(page, info, "continuous-inherited");
  const sections = page.locator('section[data-layout="split"]');
  for (const width of [390, 1920, 3840]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    for (let i = 0; i < 3; i++) {
      const geometry = await sections.nth(i).evaluate((section) => {
        const label = section.children[0]!.getBoundingClientRect(),
          content = section.children[1]!.getBoundingClientRect();
        return {
          ratio: content.width / label.width,
          stacked: content.top > label.bottom,
        };
      });
      if (width === 390) expect(geometry.stacked).toBe(true);
      else expect(geometry.ratio).toBeCloseTo(4, 1);
    }
  }
  await page
    .getByRole("button", { name: "Read full prompt", exact: true })
    .click();
  let dialog = page.locator(".inline-panel");
  await expect(dialog.getByRole("document")).toHaveText(long);
  expect(await dialog.locator("b").count()).toBe(0);
  await capture(page, info, "long-read");
  await dialog.locator(".content-viewport").evaluate((element) => {
    element.scrollTop = 350;
  });
  const readScroll = await dialog
    .locator(".content-viewport")
    .evaluate((element) => element.scrollTop);
  await dialog.getByRole("button", { name: "Customize", exact: true }).click();
  const editor = dialog.getByRole("textbox", {
    name: "Instructions",
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.fill("Never applied customization");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog.getByRole("document")).toHaveText(long);
  await expect(dialog.getByRole("document")).toBeFocused();
  expect(
    await dialog
      .locator(".content-viewport")
      .evaluate((element) => element.scrollTop),
  ).toBe(readScroll);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  let saved = await (
    await request.post("/api/personas/read", { data: { ref } })
  ).json();
  expect(saved.definition.instructions ?? []).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Read full prompt", exact: true }),
  ).toBeFocused();
  await page
    .locator("[data-instructions] article")
    .nth(1)
    .getByRole("button", { name: "Read prompt", exact: true })
    .click();
  await expect(dialog.getByRole("document")).toHaveText(
    "A short complete prompt.",
  );
  await capture(page, info, "short-read");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await addPrompt(page, "instructions.md");
  await expect(
    page.locator("[data-instructions] .prompt-text").last(),
  ).toHaveText("instructions.md");
  await resourceAction(page, "Instruction", 3, "Edit");
  dialog = page.locator(".inline-panel");
  await editor.fill("Private retained text");
  await capture(page, info, "edit-private");
  // Route navigation pauses private state, never applies it or restores an old import handle.
  await page.evaluate(() => (window.location.hash = "/sources"));
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .last()
    .click();
  await openPersona(page, name);
  await expect(page.locator(".inline-panel")).toHaveCount(0);
  await resourceAction(page, "Instruction", 3, "Edit");
  await expect(editor).toHaveValue("Private retained text");
  await editor.fill("instructions.md");
  const picker = dialog.locator('input[type="file"]');
  await picker.setInputFiles({
    name: "note.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("\ufeffImported UTF-8 é\nSecond line\n"),
  });
  await expect(
    dialog.getByRole("button", { name: "Replace text", exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveValue("instructions.md");
  await capture(page, info, "import-confirmation");
  await dialog
    .getByRole("button", { name: "Replace text", exact: true })
    .click();
  await expect(editor).toHaveValue("Imported UTF-8 é\nSecond line\n");
  await picker.setInputFiles({
    name: "image.png",
    mimeType: "image/png",
    buffer: Buffer.from([0, 1, 2]),
  });
  await expect(dialog.getByRole("alert")).toContainText("not a PDF or image");
  await expect(editor).toHaveValue("Imported UTF-8 é\nSecond line\n");
  await capture(page, info, "import-error");
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(dialog.getByRole("document")).toHaveText(
    "Imported UTF-8 é\nSecond line\n",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await capture(page, info, "continuous-populated");
  await expect(page.getByText("File", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /From file|Use a file|More instruction options/,
    }),
  ).toHaveCount(0);
  saved = await (
    await request.post("/api/personas/read", { data: { ref } })
  ).json();
  expect(saved.definition.instructions ?? []).toEqual([]);
  await save(page);
  saved = await (
    await request.post("/api/personas/read", { data: { ref } })
  ).json();
  expect(saved.definition.instructions).toEqual([
    { id: "instruction-2", text: "Imported UTF-8 é\nSecond line\n" },
  ]);
  await collection(page);
  await openPersona(page, "Test review library");
  await expect(
    page.getByText("This persona is read-only.", { exact: true }),
  ).toBeVisible();
  await capture(page, info, "readonly-resources");
});

test("late authoritative responses cannot replace saved resources; conflicts remain inspectable and repairable", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const definitions = ["One", "Two"].map((word) => ({
    schemaVersion: 1,
    name: `${word} ${suffix}`,
    instructions: [{ id: "same", text: `${word} authoritative prompt` }],
  }));
  for (const definition of definitions)
    expect(
      (
        await request.post("/api/personas/create", { data: { definition } })
      ).ok(),
    ).toBe(true);
  await page.goto("/#/persona");
  await createPersona(page, `Race ${suffix}`);
  await addParent(page, definitions[0]!.name);
  await expect(page.locator("[data-instructions]")).toContainText(
    "One authoritative prompt",
  );
  await addParent(page, definitions[1]!.name);
  await expect(page.getByRole("alert")).toContainText("same reference name");
  await expect(page.locator("[data-instructions]")).toContainText(
    "One authoritative prompt",
  );
  await expect(page.locator("[data-instructions]")).not.toContainText(
    "Two authoritative prompt",
  );
  await page
    .getByRole("button", { name: "reused persona 2 actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await save(page);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    entering = new Promise<void>((r) => (entered = r));
  let first = true,
    checks = 0;
  await page.route("**/api/personas/validate", async (route) => {
    checks++;
    const response = await route.fetch();
    if (first) {
      first = false;
      entered();
      await held;
    }
    await route.fulfill({ response });
  });
  await addPrompt(page, "First draft");
  await entering;
  await addPrompt(page, "Latest draft");
  expect(checks).toBe(1);
  await save(page); // Durable save is independent of the suspended read-only response.
  await expect(page.locator("[data-instructions]")).toContainText(
    "Latest draft",
  );
  release();
  await expect(
    page.getByText(
      "Updating resources… Last checked resources remain visible.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(page.locator("[data-instructions] .prompt-text")).toHaveText([
    "One authoritative prompt",
    "First draft",
    "Latest draft",
  ]);
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
});

test("actual picker/drop errors, replacement consent and slow file completion stay local to the current prompt", async ({
  page,
  request,
}, info) => {
  const name = `Import limits ${Date.now()}`;
  await page.goto("/#/persona");
  await createPersona(page, name);
  const ref = await refFor(request, name);
  const operations: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/personas\/(save|instruction|create)/.test(request.url()))
      operations.push(request.url());
  });
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  const dialog = page.locator(".inline-panel"),
    editor = dialog.getByRole("textbox", { name: "Instructions", exact: true }),
    picker = dialog.locator('input[type="file"]');
  await expect(editor).toBeFocused();
  await capture(page, info, "add-prompt");
  await editor.fill("Keep literal instructions.md");
  const invalid = [
    {
      name: "empty.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(0),
      error: "Enter some text",
    },
    {
      name: "binary.txt",
      mimeType: "text/plain",
      buffer: Buffer.from([0xff]),
      error: "valid UTF-8",
    },
    {
      name: "nul.txt",
      mimeType: "text/plain",
      buffer: Buffer.from([65, 0, 66]),
      error: "binary control",
    },
    {
      name: "document.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7"),
      error: "not a PDF or image",
    },
    {
      name: "large.txt",
      mimeType: "text/plain",
      buffer: Buffer.alloc(65537, 65),
      error: "at most 65536",
    },
  ];
  for (const { error, ...file } of invalid) {
    await picker.setInputFiles(file);
    await expect(dialog.getByRole("alert")).toContainText(error);
    await expect(editor).toHaveValue("Keep literal instructions.md");
  }
  await dialog
    .getByRole("group", { name: "Text editor", exact: true })
    .evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["First"], "first.txt", { type: "text/plain" }),
      );
      transfer.items.add(
        new File(["Second"], "second.txt", { type: "text/plain" }),
      );
      element.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
      );
    });
  await expect(dialog.getByRole("alert")).toContainText(
    "one text file at a time",
  );
  await picker.setInputFiles({
    name: "real.md",
    mimeType: "text/plain",
    buffer: Buffer.from("Replacement"),
  });
  await expect(
    dialog.getByRole("button", { name: "Replace text", exact: true }),
  ).toBeVisible();
  await editor.fill("Typed after consent request");
  await expect(
    dialog.getByRole("button", { name: "Replace text", exact: true }),
  ).toHaveCount(0);
  await picker.dispatchEvent("cancel");
  await expect(editor).toHaveValue("Typed after consent request");
  // Delay a real File's byte read, then dispose the route/dialog. No File or consent is retained.
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    Object.assign(window, {
      releaseImport: () => {
        File.prototype.arrayBuffer = original;
        release();
      },
    });
    File.prototype.arrayBuffer = async function () {
      await gate;
      return original.call(this);
    };
  });
  await picker.setInputFiles({
    name: "slow.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("STALE FILE TEXT"),
  });
  await expect(
    dialog.getByText("Reading text…", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window.location.hash = "/sources"));
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { releaseImport: () => void }).releaseImport(),
  );
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .last()
    .click();
  await openPersona(page, name);
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  await expect(editor).toHaveValue("Typed after consent request");
  await expect(
    dialog.getByRole("button", { name: "Replace text", exact: true }),
  ).toHaveCount(0);
  await expect(dialog).not.toContainText("STALE FILE TEXT");
  await page.keyboard.press("Escape");
  await expect(
    dialog.getByRole("button", { name: "Discard changes", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".inline-panel")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add prompt", exact: true }),
  ).toBeFocused();
  expect(operations).toEqual([]);
  expect(
    (await (await request.post("/api/personas/read", { data: { ref } })).json())
      .definition.instructions ?? [],
  ).toEqual([]);
});

test("unchanged child source failure marks retained resources stale and explicit retry refreshes without promoting the save baseline", async ({
  page,
  request,
}, info) => {
  const suffix = Date.now().toString(36),
    childName = `Freshness child ${suffix}`,
    oldText = "Selected source prompt before failure",
    newText = "Selected source prompt after repair";
  const sourceResponse = await request.post("/api/personas/create", {
    data: {
      definition: {
        schemaVersion: 1,
        name: `Freshness source ${suffix}`,
        instructions: [{ id: "selected", text: oldText }],
      },
    },
  });
  expect(sourceResponse.ok()).toBe(true);
  const source = await sourceResponse.json();
  const childResponse = await request.post("/api/personas/create", {
    data: {
      definition: {
        schemaVersion: 1,
        name: childName,
        parents: [{ ...source.ref, include: { instructions: ["selected"] } }],
      },
    },
  });
  expect(childResponse.ok()).toBe(true);
  const child = await childResponse.json();
  await page.goto("/#/persona");
  await openPersona(page, childName);
  const rows = page.locator("[data-instructions] .prompt-text"),
    saveButton = page.getByRole("button", {
      name: "Save changes",
      exact: true,
    }),
    resolution = page.getByLabel("Resource resolution", { exact: true });
  await expect(rows).toHaveText([oldText]);
  await expect(saveButton).toBeDisabled();
  await action(page, "Preview");
  const preview = page.getByRole("region", {
    name: "Persona preview",
    exact: true,
  });
  await expect(preview.getByRole("status")).toHaveText("Saved version");
  // Only the external source changes. The saved child and its explicit selection stay untouched.
  const brokenResponse = await request.post("/api/personas/save", {
    data: {
      ref: source.ref,
      expectedRevision: source.revision,
      definition: {
        ...source.definition,
        instructions: [{ id: "other", text: "Not selected" }],
      },
    },
  });
  expect(brokenResponse.ok()).toBe(true);
  const broken = await brokenResponse.json();
  await preview
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  await expect(preview.getByRole("alert")).toBeVisible();
  await expect(preview.getByRole("status")).toHaveText("Changes not checked");
  await expect(preview.getByText("Saved version", { exact: true })).toHaveCount(
    0,
  );
  await preview
    .locator("summary")
    .filter({ hasText: /^Instruction text$/ })
    .click();
  await expect(preview.getByText(oldText, { exact: true })).toBeVisible();
  await capture(page, info, "source-failure-preview");
  await page.keyboard.press("Escape");
  await expect(resolution.getByRole("status")).toContainText(
    "Resources not checked",
  );
  await expect(resolution.getByRole("alert")).toBeVisible();
  await expect(rows).toHaveText([oldText]);
  await expect(saveButton).toBeDisabled();
  await capture(page, info, "source-failure-page");
  await page.getByRole("button", { name: "Read prompt", exact: true }).click();
  const reader = page.getByRole("region", { name: "Prompt", exact: true });
  await expect(reader.getByRole("document")).toHaveText(oldText);
  await reader.getByRole("button", { name: "Close", exact: true }).click();
  const repairedResponse = await request.post("/api/personas/save", {
    data: {
      ref: source.ref,
      expectedRevision: broken.revision,
      definition: {
        ...source.definition,
        instructions: [{ id: "selected", text: newText }],
      },
    },
  });
  expect(repairedResponse.ok()).toBe(true);
  // Repair alone must not silently refresh or promote this child's held baseline.
  await expect(rows).toHaveText([oldText]);
  await expect(resolution.getByRole("status")).toContainText(
    "Resources not checked",
  );
  await action(page, "Preview");
  await expect(preview.getByRole("status")).toHaveText("Changes not checked");
  await preview
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  await expect(preview.getByRole("status")).toHaveText("Saved version");
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await preview
    .locator("summary")
    .filter({ hasText: /^Instruction text$/ })
    .click();
  await expect(preview.getByText(newText, { exact: true })).toBeVisible();
  await capture(page, info, "source-retry-preview");
  await page.keyboard.press("Escape");
  await expect(resolution.getByRole("status")).toHaveCount(0);
  await expect(resolution.getByRole("alert")).toHaveCount(0);
  await expect(rows).toHaveText([newText]);
  await expect(saveButton).toBeDisabled();
  await capture(page, info, "source-retry-page");
  const current = await (
    await request.post("/api/personas/read", { data: { ref: child.ref } })
  ).json();
  expect(current.definition).toEqual(child.definition);
  expect(current.revision).not.toBe(child.revision);
  // The UI still holds its original management revision, not the read-only retry revision.
  await addPrompt(page, "Local repairable draft after retry");
  await saveButton.click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(rows).toContainText([
    newText,
    "Local repairable draft after retry",
  ]);
  expect(
    (
      await (
        await request.post("/api/personas/read", { data: { ref: child.ref } })
      ).json()
    ).definition,
  ).toEqual(child.definition);
});

test("confirmed customization becomes one local override and retains later private edits on that same target", async ({
  page,
  request,
}) => {
  const sourceName = `Customize source ${Date.now()}`,
    childName = `Customize child ${Date.now()}`;
  await request.post("/api/personas/create", {
    data: {
      definition: {
        schemaVersion: 1,
        name: sourceName,
        instructions: [{ id: "tone", text: "Original source text" }],
      },
    },
  });
  await page.goto("/#/persona");
  await createPersona(page, childName);
  await addParent(page, sourceName);
  await expect(page.locator("[data-instructions] .prompt-text")).toHaveText(
    "Original source text",
  );
  await resourceAction(page, "Instruction", 1, "Customize");
  const dialog = page.locator(".inline-panel"),
    editor = dialog.getByRole("textbox", { name: "Instructions", exact: true });
  await editor.fill("Confirmed local replacement");
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(dialog.getByRole("document")).toHaveText(
    "Confirmed local replacement",
  );
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await editor.fill("Later private edit");
  await page.evaluate(() => (window.location.hash = "/sources"));
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .last()
    .click();
  await openPersona(page, childName);
  await resourceAction(page, "Instruction", 1, "Edit");
  await expect(editor).toHaveValue("Later private edit");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog.getByRole("document")).toHaveText(
    "Confirmed local replacement",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await save(page);
  const child = await refFor(request, childName),
    source = await refFor(request, sourceName);
  expect(
    (
      await (
        await request.post("/api/personas/read", { data: { ref: child } })
      ).json()
    ).definition.instructions,
  ).toEqual([
    { id: "tone", text: "Confirmed local replacement", replace: true },
  ]);
  expect(
    (
      await (
        await request.post("/api/personas/read", { data: { ref: source } })
      ).json()
    ).definition.instructions,
  ).toEqual([{ id: "tone", text: "Original source text" }]);
});
