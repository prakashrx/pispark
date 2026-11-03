import { test, expect } from "@playwright/test";

test("real persona editor persists ordered text/files, inheritance/overrides and native skill support reads", async ({
  page,
  request,
}, info) => {
  const suffix = Date.now().toString(36),
    base = `Base ${suffix}`,
    child = `Writer ${suffix}`;
  await page.goto("/#/persona");
  await page
    .getByRole("textbox", { name: "New persona name", exact: true })
    .fill(base);
  await page
    .getByRole("textbox", { name: "New persona name", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Display Name", exact: true }),
  ).toHaveValue(base);
  await page
    .getByRole("button", { name: "Add text instruction", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Instruction 1 ID", exact: true })
    .fill("tone");
  await page
    .getByRole("textbox", { name: "Instruction 1 text", exact: true })
    .fill("Base tone");
  await page
    .getByRole("button", { name: "Add text instruction", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Instruction 2 ID", exact: true })
    .fill("extra");
  await page
    .getByRole("textbox", { name: "Instruction 2 text", exact: true })
    .fill("Exclude this inherited entry");
  await page
    .getByRole("button", { name: "Add file instruction", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Instruction 3 ID", exact: true })
    .fill("rules");
  await page
    .getByText("Owned instruction file editor", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "File text: rules.md", exact: true })
    .fill("File rules persisted separately");
  await page
    .getByRole("button", { name: "Save instruction file", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^File saved/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Move instruction 3 up", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Instruction 2 ID", exact: true }),
  ).toHaveValue("rules");
  await expect(
    page.getByRole("button", { name: "Move instruction 2 up", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Save Persona", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  const fileEditor = page.locator("details").filter({
    has: page.getByText("Owned instruction file editor", { exact: true }),
  });
  if ((await fileEditor.getAttribute("open")) === null)
    await fileEditor.locator("summary").click();
  await page
    .getByRole("button", { name: "Load saved file", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "File text: rules.md", exact: true }),
  ).toHaveValue("File rules persisted separately");
  await page
    .getByRole("textbox", { name: "File text: rules.md", exact: true })
    .fill("File rules edited with its own revision");
  await page
    .getByRole("button", { name: "Save instruction file", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^File saved/ }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "New persona name", exact: true })
    .fill(child);
  await page
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Display Name", exact: true }),
  ).toHaveValue(child);
  await page
    .getByRole("combobox", { name: "Add parent persona", exact: true })
    .selectOption({ label: `${base} · managed` });
  await page.getByRole("button", { name: "Add parent", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Add parent persona", exact: true })
    .selectOption({ label: "Test review library · examples" });
  await page.getByRole("button", { name: "Add parent", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "All parent instructions", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Space");
  await page
    .getByRole("textbox", {
      name: "Parent 1 included instructions",
      exact: true,
    })
    .fill("tone, rules, extra");
  await page
    .getByRole("textbox", {
      name: "Parent 1 included instructions",
      exact: true,
    })
    .press("Tab");
  await page
    .getByRole("textbox", { name: "Excluded instructions IDs", exact: true })
    .fill("extra");
  await page
    .getByRole("textbox", { name: "Excluded instructions IDs", exact: true })
    .press("Tab");
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replace tone", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replace tone", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Instruction 1 text", exact: true })
    .fill("Child tone override");
  await page.getByRole("button", { name: "Save Persona", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Inspect JSON", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Persona JSON", exact: true }),
  ).toContainText("replace");
  for (const width of [390, 1920, 3840]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`persona-${width}.png`),
      fullPage: true,
    });
  }
  await page.reload();
  await page
    .getByRole("combobox", { name: "Edit persona", exact: true })
    .selectOption({ label: child });
  await expect(
    page.getByRole("textbox", { name: "Instruction 1 text", exact: true }),
  ).toHaveValue("Child tone override");
  await page
    .getByRole("button", {
      name: "Persona: No persona (host defaults)",
      exact: true,
    })
    .click();
  await page
    .getByRole("listbox", { name: "Persona", exact: true })
    .getByRole("option", { name: child, exact: true })
    .click();
  const personaContext = page.getByRole("button", {
    name: `Persona: ${child}`,
    exact: true,
  });
  await personaContext.click();
  await page
    .getByRole("combobox", { name: "Host policy", exact: true })
    .selectOption("Catalog resources");
  await expect(
    page.getByText("This host policy does not provide a skill-reading tool.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Host policy", exact: true })
    .selectOption("Test-only deterministic");
  await page.keyboard.press("Escape");
  await expect(personaContext).toBeFocused();
  await page
    .getByRole("textbox", { name: "Ask anything", exact: true })
    .fill("read-skill-support");
  await page
    .getByRole("textbox", { name: "Ask anything", exact: true })
    .press("Enter");
  await expect(page.getByText(/local:.*NATIVE-COPIED-SUPPORT/)).toBeVisible();
  await expect(
    page.getByText(new RegExp(`Admitted persona: ${child}`)),
  ).toBeVisible();
  const { sessions } = await (await request.get("/api/sessions")).json();
  const admitted = sessions.find(
    (s: { persona?: { name: string } }) => s.persona?.name === child,
  );
  expect(admitted.persona.name).toBe(child);
  await page
    .getByRole("button", { name: "Stop / unload", exact: true })
    .click();
});

test("real stale save keeps editor draft and route navigation keeps unsaved file drafts", async ({
  page,
  request,
}) => {
  await page.goto("/#/persona");
  await page
    .getByRole("textbox", { name: "New persona name" })
    .fill(`Conflict ${Date.now()}`);
  await page
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Display Name" }),
  ).toBeVisible();
  const key = await page
    .getByRole("combobox", { name: "Edit persona" })
    .inputValue();
  const ref = JSON.parse(key);
  const saved = await (
    await request.post("/api/personas/read", { data: { ref } })
  ).json();
  const response = await request.post("/api/personas/save", {
    data: {
      ref,
      expectedRevision: saved.revision,
      definition: { ...saved.definition, description: "Other tab saved" },
    },
  });
  expect(response.ok()).toBe(true);
  await page
    .getByRole("textbox", { name: "Persona description" })
    .fill("Keep my stale draft");
  await page.getByRole("button", { name: "Save Persona", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /revision-conflict/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Persona description" }),
  ).toHaveValue("Keep my stale draft");
  await page
    .getByRole("button", { name: "Add file instruction", exact: true })
    .click();
  await page
    .getByText("Owned instruction file editor", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "File text: rules.md" })
    .fill("Unsaved separate file draft");
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .click();
  await page
    .getByText("Owned instruction file editor · Unsaved file text", {
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "File text: rules.md" }),
  ).toHaveValue("Unsaved separate file draft");
});

test("invalid catalog entries retain distinct safe identities and diagnostics without lossy editing", async ({
  page,
  request,
}, info) => {
  const catalog = await (await request.get("/api/personas")).json();
  let invalidReads = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/personas/read") && !req.postDataJSON()?.ref.id)
      invalidReads++;
  });
  await page.goto("/#/persona");
  for (const path of [
    "malformed-one",
    "malformed-two",
    "unsupported",
    "missing",
    "cycle-a",
  ]) {
    const item = catalog.personas.find(
      (p: { ref: { path: string } }) => p.ref.path === path,
    );
    await page
      .getByRole("combobox", { name: "Edit persona", exact: true })
      .selectOption(JSON.stringify(item.ref));
    const diagnostics = page.getByRole("region", {
      name: "Catalog diagnostics",
    });
    await expect(diagnostics).toContainText(`examples/${path}`);
    await expect(diagnostics).toContainText(item.diagnostics[0].code);
    await expect(
      page.getByRole("button", { name: "Save Persona", exact: true }),
    ).toBeDisabled();
    if (["malformed-one", "malformed-two", "unsupported"].includes(path)) {
      await expect(
        page.getByRole("textbox", { name: "Display Name", exact: true }),
      ).toHaveCount(0);
      await expect(diagnostics).toContainText("has not been reconstructed");
    } else {
      await expect(
        page.getByRole("textbox", { name: "Display Name", exact: true }),
      ).toBeDisabled();
    }
  }
  expect(invalidReads).toBe(0);
  const malformed = catalog.personas.find(
    (p: { ref: { path: string } }) => p.ref.path === "malformed-one",
  );
  await page
    .getByRole("combobox", { name: "Edit persona", exact: true })
    .selectOption(JSON.stringify(malformed.ref));
  await expect(
    page.getByRole("region", { name: "Catalog diagnostics" }),
  ).toContainText("examples/malformed-one");
  const invalidOptions = await page
    .getByRole("combobox", { name: "Edit persona", exact: true })
    .locator("option")
    .allTextContents();
  expect(
    invalidOptions.some((label) => label.includes("examples/malformed-one")),
  ).toBe(true);
  expect(
    invalidOptions.some((label) => label.includes("examples/malformed-two")),
  ).toBe(true);
  for (const width of [390, 1920, 3840]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`invalid-${width}.png`),
      fullPage: true,
    });
  }
});

for (const graph of ["definition", "parent"] as const)
  for (const newFile of [false, true]) {
    test(`two real tabs reconcile file save after concurrent ${graph} change (${newFile ? "new" : "existing"} owned file)`, async ({
      page,
      context,
      request,
    }, info) => {
      const post = async (operation: string, data: unknown) => {
        const response = await request.post(`/api/personas/${operation}`, {
          data,
        });
        expect(response.ok()).toBe(true);
        return response.json();
      };
      const parent = await post("create", {
        definition: { schemaVersion: 1, name: `Parent ${Date.now()}` },
      });
      let child = await post("create", {
        definition: {
          schemaVersion: 1,
          name: `File race ${Date.now()}`,
          parents: [parent.ref],
        },
      });
      if (!newFile) {
        await post("instruction", {
          ref: child.ref,
          path: "rules.md",
          expectedRevision: null,
          text: "Original file",
        });
        child = await post("save", {
          ref: child.ref,
          expectedRevision: child.revision,
          definition: {
            ...child.definition,
            instructions: [{ id: "rules", file: "rules.md" }],
          },
        });
      }
      await page.goto("/#/persona");
      await page
        .getByRole("combobox", { name: "Edit persona", exact: true })
        .selectOption(JSON.stringify(child.ref));
      await expect(
        page.getByRole("textbox", { name: "Display Name", exact: true }),
      ).toHaveValue(child.definition.name);
      const other = await context.newPage();
      await other.goto("/#/persona");
      const target = graph === "parent" ? parent : child;
      await other
        .getByRole("combobox", { name: "Edit persona", exact: true })
        .selectOption(JSON.stringify(target.ref));
      await other
        .getByRole("textbox", { name: "Persona description", exact: true })
        .fill("Other tab durable update");
      await other
        .getByRole("button", { name: "Save Persona", exact: true })
        .click();
      await expect(
        other.getByRole("status").filter({ hasText: /^Saved$/ }),
      ).toBeVisible();
      await page
        .getByRole("textbox", { name: "Persona description", exact: true })
        .fill("Keep my stale definition draft");
      if (newFile)
        await page
          .getByRole("button", { name: "Add file instruction", exact: true })
          .click();
      await page
        .getByText("Owned instruction file editor", { exact: true })
        .click();
      if (!newFile)
        await page
          .getByRole("button", { name: "Load saved file", exact: true })
          .click();
      await page
        .getByRole("textbox", { name: "File text: rules.md", exact: true })
        .fill("File save still succeeds");
      await page
        .getByRole("button", { name: "Save instruction file", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: /^File saved/ }),
      ).toBeVisible();
      await expect(
        page.getByRole("alert").filter({ hasText: /parent graph changed/ }),
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Persona description", exact: true }),
      ).toHaveValue("Keep my stale definition draft");
      await expect(
        page.getByRole("textbox", { name: "File text: rules.md", exact: true }),
      ).toHaveValue("File save still succeeds");
      await expect(
        page.getByRole("button", { name: "Save Persona", exact: true }),
      ).toBeDisabled();
      const durable = await post("read", { ref: target.ref });
      expect(durable.definition.description).toBe("Other tab durable update");
      const stale = await request.post("/api/personas/save", {
        data: {
          ref: child.ref,
          expectedRevision: child.revision,
          definition: { ...child.definition, description: "Stale overwrite" },
        },
      });
      expect(stale.status()).toBe(409);
      if (graph === "parent" && newFile)
        for (const width of [390, 1920, 3840]) {
          await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1200,
          });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: info.outputPath(`reconciliation-${width}.png`),
            fullPage: true,
          });
        }
      await other.close();
    });
  }
