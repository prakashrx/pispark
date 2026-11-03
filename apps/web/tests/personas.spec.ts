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
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue(base);
  await page
    .getByRole("button", { name: "Add instruction", exact: true })
    .click();
  await page
    .locator("details")
    .filter({
      has: page.getByRole("textbox", {
        name: "Instruction 1 reference name",
        exact: true,
        includeHidden: true,
      }),
    })
    .locator("summary")
    .click();
  await page
    .getByRole("textbox", { name: "Instruction 1 reference name", exact: true })
    .fill("tone");
  await page
    .getByRole("textbox", { name: "Instruction 1 text", exact: true })
    .fill("Base tone");
  await page
    .getByRole("button", { name: "Add instruction", exact: true })
    .click();
  await page
    .locator("details")
    .filter({
      has: page.getByRole("textbox", {
        name: "Instruction 2 reference name",
        exact: true,
        includeHidden: true,
      }),
    })
    .locator("summary")
    .click();
  await page
    .getByRole("textbox", { name: "Instruction 2 reference name", exact: true })
    .fill("extra");
  await page
    .getByRole("textbox", { name: "Instruction 2 text", exact: true })
    .fill("Exclude this inherited entry");
  await page.getByRole("button", { name: "Use a file", exact: true }).click();
  await page
    .locator("details")
    .filter({
      has: page.getByRole("textbox", {
        name: "Instruction 3 reference name",
        exact: true,
        includeHidden: true,
      }),
    })
    .locator("summary")
    .click();
  await page
    .getByRole("textbox", { name: "Instruction 3 reference name", exact: true })
    .fill("rules");
  await page.getByText("Edit file", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "File text: rules.md", exact: true })
    .fill("File rules persisted separately");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^File saved\.$/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Move instruction 3 up", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", {
      name: "Instruction 2 reference name",
      exact: true,
    }),
  ).toHaveValue("rules");
  await expect(
    page.getByRole("button", { name: "Move instruction 2 up", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Save persona", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  const fileEditor = page.locator("details").filter({
    has: page.getByText("Edit file", { exact: true }),
  });
  if ((await fileEditor.getAttribute("open")) === null)
    await fileEditor.locator("summary").click();
  await page.getByRole("button", { name: "Load file", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "File text: rules.md", exact: true }),
  ).toHaveValue("File rules persisted separately");
  await page
    .getByRole("textbox", { name: "File text: rules.md", exact: true })
    .fill("File rules edited with its own revision");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^File saved\.$/ }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "New persona name", exact: true })
    .fill(child);
  await page
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue(child);
  await page
    .getByRole("combobox", {
      name: "Choose a persona to build on",
      exact: true,
    })
    .selectOption({ label: base });
  await page.getByRole("button", { name: "Add persona", exact: true }).click();
  await page
    .getByRole("combobox", {
      name: "Choose a persona to build on",
      exact: true,
    })
    .selectOption({ label: "Test review library" });
  await page.getByRole("button", { name: "Add persona", exact: true }).click();
  await page.getByText("Choose what to use", { exact: true }).first().click();
  await expect(
    page.getByRole("checkbox", {
      name: "1 · instructions · Base tone",
      exact: true,
    }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", {
      name: "1 · instructions · Exclude this inherited entry",
      exact: true,
    })
    .uncheck();
  await page.getByText("Preview", { exact: true }).click();
  await page
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Customize Base tone", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Customize Base tone", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Instruction 1 text", exact: true })
    .fill("Child tone override");
  await page.getByRole("button", { name: "Save persona", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Don’t use File rules edited with its own revision",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Save persona", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  await page
    .locator("main > div > details")
    .filter({
      has: page.locator(":scope > summary", { hasText: /^Advanced$/ }),
    })
    .locator(":scope > summary")
    .click();
  await page.getByRole("button", { name: "View JSON", exact: true }).click();
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
    .getByRole("combobox", { name: "Choose a persona", exact: true })
    .selectOption({ label: child });
  await expect(
    page.getByRole("textbox", { name: "Instruction 1 text", exact: true }),
  ).toHaveValue("Child tone override");
  await page
    .getByRole("button", {
      name: "Persona: No persona",
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
  await page.locator("[data-selector-popup] summary").click();
  await page
    .getByRole("combobox", { name: "Chat setup", exact: true })
    .selectOption("Catalog resources");
  await expect(
    page.getByText(
      "Skills need file access, which this chat setup doesn’t allow.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Chat setup", exact: true })
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
  await expect(page.getByText(/Admitted persona:/)).toHaveCount(0);
  await page.getByText("Chat details", { exact: true }).click();
  await expect(page.getByText(child, { exact: true }).last()).toBeVisible();
  const { sessions } = await (await request.get("/api/sessions")).json();
  const admitted = sessions.find(
    (s: { persona?: { name: string } }) => s.persona?.name === child,
  );
  expect(admitted.persona.name).toBe(child);
  await page.getByRole("button", { name: "Stop agent", exact: true }).click();
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
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toBeVisible();
  const key = await page
    .getByRole("combobox", { name: "Choose a persona", exact: true })
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
  await page.getByRole("button", { name: "Save persona", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /This persona changed elsewhere/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Persona description" }),
  ).toHaveValue("Keep my stale draft");
  await page.getByRole("button", { name: "Use a file", exact: true }).click();
  await page.getByText("Edit file", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "File text: rules.md" })
    .fill("Unsaved separate file draft");
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .last()
    .click();
  await page
    .getByText("Edit file · Unsaved changes", {
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
      .getByRole("combobox", { name: "Choose a persona", exact: true })
      .selectOption(JSON.stringify(item.ref));
    const diagnostics = page.getByRole("region", {
      name: "Catalog diagnostics",
    });
    await expect(diagnostics).toContainText(`examples/${path}`);
    if ((await diagnostics.locator("details").getAttribute("open")) === null)
      await diagnostics.locator("summary").click();
    await expect(diagnostics).toContainText(item.diagnostics[0].code);
    await expect(
      page.getByRole("button", { name: "Save persona", exact: true }),
    ).toBeDisabled();
    if (["malformed-one", "malformed-two", "unsupported"].includes(path)) {
      await expect(
        page.getByRole("textbox", { name: "Name", exact: true }),
      ).toHaveCount(0);
      await expect(diagnostics).toContainText("has not been reconstructed");
    } else {
      await expect(
        page.getByRole("textbox", { name: "Name", exact: true }),
      ).toBeDisabled();
    }
  }
  expect(invalidReads).toBe(0);
  const malformed = catalog.personas.find(
    (p: { ref: { path: string } }) => p.ref.path === "malformed-one",
  );
  await page
    .getByRole("combobox", { name: "Choose a persona", exact: true })
    .selectOption(JSON.stringify(malformed.ref));
  await expect(
    page.getByRole("region", { name: "Catalog diagnostics" }),
  ).toContainText("examples/malformed-one");
  const invalidOptions = await page
    .getByRole("combobox", { name: "Choose a persona", exact: true })
    .locator("option")
    .allTextContents();
  expect(
    invalidOptions.some((label) =>
      label.includes("Needs attention · malformed-one"),
    ),
  ).toBe(true);
  expect(
    invalidOptions.some((label) =>
      label.includes("Needs attention · malformed-two"),
    ),
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
        .getByRole("combobox", { name: "Choose a persona", exact: true })
        .selectOption(JSON.stringify(child.ref));
      await expect(
        page.getByRole("textbox", { name: "Name", exact: true }),
      ).toHaveValue(child.definition.name);
      const other = await context.newPage();
      await other.goto("/#/persona");
      const target = graph === "parent" ? parent : child;
      await other
        .getByRole("combobox", { name: "Choose a persona", exact: true })
        .selectOption(JSON.stringify(target.ref));
      await other
        .getByRole("textbox", { name: "Persona description", exact: true })
        .fill("Other tab durable update");
      await other
        .getByRole("button", { name: "Save persona", exact: true })
        .click();
      await expect(
        other.getByRole("status").filter({ hasText: /^Saved$/ }),
      ).toBeVisible();
      await page
        .getByRole("textbox", { name: "Persona description", exact: true })
        .fill("Keep my stale definition draft");
      if (newFile)
        await page
          .getByRole("button", { name: "Use a file", exact: true })
          .click();
      await page.getByText("Edit file", { exact: true }).click();
      if (!newFile)
        await page
          .getByRole("button", { name: "Load file", exact: true })
          .click();
      await page
        .getByRole("textbox", { name: "File text: rules.md", exact: true })
        .fill("File save still succeeds");
      await page
        .getByRole("button", { name: "Save file", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: /^File saved\.$/ }),
      ).toBeVisible();
      await expect(
        page.getByRole("alert").filter({
          hasText: /The file was saved, but this persona changed elsewhere/,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Persona description", exact: true }),
      ).toHaveValue("Keep my stale definition draft");
      await expect(
        page.getByRole("textbox", { name: "File text: rules.md", exact: true }),
      ).toHaveValue("File save still succeeds");
      await expect(
        page.getByRole("button", { name: "Save persona", exact: true }),
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

test("ordinary journey creates instructions without reference editing, shows real settings and names a quiet chat", async ({
  page,
  request,
}, info) => {
  const name = `Simple writer ${Date.now().toString(36)}`;
  await page.goto("/#/persona");
  await page
    .getByRole("textbox", { name: "New persona name", exact: true })
    .fill(name);
  await page
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue(name);
  await page
    .getByRole("button", { name: "Add instruction", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Instruction 1 text", exact: true })
    .fill("Explain things simply.");
  await expect(
    page.getByRole("textbox", {
      name: "Instruction 1 reference name",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check changes", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View JSON", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("");
  await page.getByText("Preview", { exact: true }).click();
  await page
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Check this persona’s name, instructions, and skills.",
  );
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "Instruction 1 text", exact: true }),
  ).toHaveValue("Explain things simply.");
  expect(await page.getByRole("main").innerText()).not.toContain(
    "invalid-definition",
  );
  await page
    .getByRole("main")
    .getByText("Details", { exact: true })
    .first()
    .click();
  await expect(page.getByText(/^invalid-definition/)).toBeVisible();
  await page
    .getByRole("main")
    .getByText("Details", { exact: true })
    .first()
    .click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByText("Preview", { exact: true }).click();
  await page.getByRole("button", { name: "Save persona", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Saved$/ }),
  ).toBeVisible();
  const ref = JSON.parse(
    await page
      .getByRole("combobox", { name: "Choose a persona", exact: true })
      .inputValue(),
  );
  const saved = await (
    await request.post("/api/personas/read", { data: { ref } })
  ).json();
  expect(saved.definition.instructions).toEqual([
    { id: "instruction-1", text: "Explain things simply." },
  ]);
  const capture = async (surface: string) => {
    for (const width of [390, 1920, 3840]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`ordinary-${surface}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  };
  expect(await page.getByRole("main").innerText()).not.toContain(ref.id);
  await capture("persona");
  await page.getByText("Preview", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("This persona", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check changes", exact: true }),
  ).toBeVisible();
  await page.goto("/#/settings");
  const catalog = await (await request.get("/api/catalog")).json();
  for (const folder of catalog.workspaces)
    await expect(
      page.getByRole("main").getByText(folder.label, { exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Light", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Default persona" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Save changes|Reset to defaults|Dark|System/,
    }),
  ).toHaveCount(0);
  await capture("general");
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(
    page.getByText(/Source connections aren’t available yet/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Add Source|Sync/ }),
  ).toHaveCount(0);
  await capture("sources");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Manage personas", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Persona: No persona", exact: true })
    .click();
  await page
    .getByRole("listbox", { name: "Persona", exact: true })
    .getByRole("option", { name, exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Ask anything", exact: true })
    .fill("A friendly chat name");
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(
    page.getByText("local:A friendly chat name", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  const id = await page.evaluate(() => localStorage.getItem("pispark-session"));
  await expect(
    page.getByRole("heading", { name: "A friendly chat name", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^A friendly chat name/ }),
  ).toBeVisible();
  const ordinaryText = await page.getByRole("main").innerText();
  expect(ordinaryText).not.toMatch(/Admitted|Queued:|idle|Live|Connected/);
  expect(ordinaryText).not.toContain(id!);
  expect(ordinaryText).not.toContain(saved.revision);
  await expect(
    page.getByRole("button", { name: "Stop agent", exact: true }),
  ).toHaveCount(0);
  await capture("chat");
  await page.getByText("Chat details", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(id!, { exact: true })).toBeVisible();
  await expect(page.getByText(saved.revision, { exact: true })).toBeVisible();
  await capture("chat-details");
  await page.getByRole("button", { name: "Stop agent", exact: true }).click();
  await expect(
    page.getByText("Connection lost. Your chat may still be running."),
  ).toHaveCount(0);
});

test("two real tabs reload Based on choices and unchecking an old instruction preserves the newly inherited resource", async ({
  page,
  context,
  request,
}, info) => {
  const post = async (op: string, data: unknown) => {
    const response = await request.post(`/api/personas/${op}`, { data });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const parent = await post("create", {
    definition: {
      schemaVersion: 1,
      name: `Reload base ${Date.now()}`,
      instructions: [{ id: "old", text: "Old inherited instruction" }],
    },
  });
  const child = await post("create", {
    definition: {
      schemaVersion: 1,
      name: `Reload child ${Date.now()}`,
      parents: [parent.ref],
    },
  });
  await page.goto("/#/persona");
  await page
    .getByRole("combobox", { name: "Choose a persona", exact: true })
    .selectOption(JSON.stringify(child.ref));
  await page.getByText("Choose what to use", { exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "1 · instructions · Old inherited instruction",
      exact: true,
    }),
  ).toBeChecked();
  const other = await context.newPage();
  try {
    await other.goto("/#/persona");
    await other
      .getByRole("combobox", { name: "Choose a persona", exact: true })
      .selectOption(JSON.stringify(parent.ref));
    await other
      .getByRole("button", { name: "Add instruction", exact: true })
      .click();
    await other
      .getByRole("textbox", { name: "Instruction 2 text", exact: true })
      .fill("Newly inherited instruction");
    await other
      .getByRole("button", { name: "Save persona", exact: true })
      .click();
    await expect(
      other.getByRole("status").filter({ hasText: /^Saved$/ }),
    ).toBeVisible();
    const advanced = page.locator("main > div > details").filter({
      has: page.locator(":scope > summary", { hasText: /^Advanced$/ }),
    });
    await advanced.locator(":scope > summary").click();
    await page
      .getByRole("button", { name: "Reload saved version", exact: true })
      .click();
    const added = page.getByRole("checkbox", {
      name: "1 · instructions · Newly inherited instruction",
      exact: true,
    });
    await expect(
      page.getByRole("checkbox", {
        name: "1 · instructions · Newly inherited instruction",
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(1);
    const choices = page.locator("details").filter({
      has: page.locator(":scope > summary", {
        hasText: /^Choose what to use$/,
      }),
    });
    if ((await choices.getAttribute("open")) === null)
      await choices.locator(":scope > summary").click();
    await expect(added).toBeVisible();
    await expect(added).toBeChecked();
    await page
      .getByRole("checkbox", {
        name: "1 · instructions · Old inherited instruction",
        exact: true,
      })
      .uncheck();
    await expect(added).toBeChecked();
    for (const width of [390, 1920]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
      await page.screenshot({
        path: info.outputPath(`reloaded-choices-${width}.png`),
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Save persona", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: /^Saved$/ }),
    ).toBeVisible();
    const saved = await post("read", { ref: child.ref });
    expect(saved.instructions.map((r: { text: string }) => r.text)).toEqual([
      "Newly inherited instruction",
    ]);
    expect(saved.definition.parents[0].include.instructions).toEqual([
      "instruction-1",
    ]);
  } finally {
    await other.close();
  }
});

test("creation completed while editing is a visible success status, not a failed-save alert", async ({
  page,
}, info) => {
  await page.goto("/#/persona");
  const newName = page.getByRole("textbox", {
    name: "New persona name",
    exact: true,
  });
  await newName.fill(`Original editor ${Date.now()}`);
  await page
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeVisible();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const entering = new Promise<void>((r) => {
    entered = r;
  });
  await page.route("**/api/personas/create", async (route) => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  const created = `Created elsewhere ${Date.now()}`;
  await newName.fill(created);
  await page
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  await entering;
  await name.fill("Current unsaved name");
  release();
  const copy =
    "Persona created. Your current edits are still here. Choose the new persona from the list when you’re ready.";
  await expect(page.getByText(copy, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: copy }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(name).toHaveValue("Current unsaved name");
  await expect(
    page
      .getByRole("combobox", { name: "Choose a persona", exact: true })
      .locator("option")
      .filter({ hasText: created }),
  ).toHaveCount(1);
  await expect(
    page.getByText("No instructions added here.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No skills added here.", { exact: true }),
  ).toBeVisible();
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    await page.screenshot({
      path: info.outputPath(`created-status-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByText("Preview", { exact: true }).click();
  await page
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  await expect(page.getByText(copy, { exact: true })).toHaveCount(0);
  await expect(name).toHaveValue("Current unsaved name");
});

test("duplicate empty persona files show identity repair copy with closed technical Details", async ({
  page,
}, info) => {
  // Browser-only catalog fixture: native duplicate detection blocks writes across the entire store.
  // Keep that malformed collection isolated from the shared real-backend journey fixture.
  const personas = ["duplicate-empty-one", "duplicate-empty-two"].map(
    (path) => ({
      ref: {
        root: "examples",
        path,
        id: "10000000-0000-4000-8000-000000000009",
      },
      name: path,
      valid: false,
      writable: false,
      diagnostics: [{ code: "duplicate-identity" }],
    }),
  );
  await page.route("**/api/personas", (route) =>
    route.fulfill({ json: { personas } }),
  );
  await page.route("**/api/personas/read", (route) => {
    const ref = route.request().postDataJSON().ref;
    return route.fulfill({
      json: {
        ref,
        definition: {
          schemaVersion: 1,
          id: ref.id,
          name: ref.path,
          instructions: [],
          skills: [],
        },
        writable: false,
        definitionRevision: "fixture",
        instructions: [],
        skills: [],
        excluded: [],
        diagnostics: [{ code: "duplicate-identity" }],
      },
    });
  });
  await page.goto("/#/persona");
  for (const path of ["duplicate-empty-one", "duplicate-empty-two"]) {
    const item = personas.find(
      (p: { ref: { path: string } }) => p.ref.path === path,
    )!;
    expect(item.valid).toBe(false);
    await page
      .getByRole("combobox", { name: "Choose a persona", exact: true })
      .selectOption(JSON.stringify(item.ref));
    const region = page.getByRole("region", { name: "Catalog diagnostics" });
    const reason = region.getByText(
      "These persona files share the same identity. Fix the duplicate files to continue.",
      { exact: true },
    );
    await expect(reason).toBeVisible();
    await expect(region.locator("details")).not.toHaveAttribute("open", "");
    await expect(region).toContainText(`examples/${path}`);
    await expect(region).not.toContainText("same reference name");
    await region.getByText("Details", { exact: true }).click();
    await expect(
      region.getByText("duplicate-identity", { exact: true }),
    ).toBeVisible();
    await expect(region).toContainText(item.ref.id);
    await region.getByText("Details", { exact: true }).click();
  }
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    await page.screenshot({
      path: info.outputPath(`duplicate-identity-${width}.png`),
      fullPage: true,
    });
  }
});

test("32 dirty file drafts block a new editor with visible recovery copy and preserve the first draft", async ({
  page,
}, info) => {
  await page.goto("/#/persona");
  await page
    .getByRole("textbox", { name: "New persona name", exact: true })
    .fill(`Draft capacity ${Date.now()}`);
  await page
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use a file", exact: true }).click();
  const path = page.getByRole("textbox", {
    name: "File · instruction 1",
    exact: true,
  });
  for (let i = 0; i < 32; i++) {
    await path.fill(`draft-${i}.md`);
    await page.getByText("Edit file", { exact: true }).click();
    await page
      .getByRole("textbox", { name: `File text: draft-${i}.md`, exact: true })
      .fill(`Retained file draft ${i}`);
  }
  await path.fill("blocked.md");
  await page.getByText("Edit file", { exact: true }).click();
  const reason = page.getByText(
    "Too many files have unsaved changes. Save one, then reopen this file.",
    { exact: true },
  );
  await expect(reason).toBeVisible();
  await expect(reason).toHaveAttribute("role", "alert");
  await expect(
    page.getByRole("textbox", { name: "File text: blocked.md", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save file", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").locator("..").locator("details"),
  ).not.toHaveAttribute("open", "");
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    await page.screenshot({
      path: info.outputPath(`draft-capacity-${width}.png`),
      fullPage: true,
    });
  }
  await path.fill("draft-0.md");
  await page.getByText("Edit file · Unsaved changes", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "File text: draft-0.md", exact: true }),
  ).toHaveValue("Retained file draft 0");
});
