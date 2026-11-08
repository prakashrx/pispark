import { hostedTest } from "./isolated-host";
import { test, expect, type Page } from "@playwright/test";
import {
  collection,
  createPersona,
  openPersona,
  action,
  metadata,
  save,
  addFile,
  addPrompt,
  editFile,
  resourceAction,
  reference,
  addParent,
  refFor,
  capture,
} from "./persona-journey";

hostedTest("metadata changes stay with the persona that opened the panel", async ({ page, request }) => {
  const names = ["Alpha metadata owner", "Beta metadata owner"];
  const refs = [];
  for (const name of names) {
    const res = await request.post("/api/personas/create", { data: { definition: { schemaVersion: 1, name } } });
    expect(res.ok()).toBe(true);
    refs.push((await res.json()).ref);
  }
  await page.goto("/#/persona");
  await page.getByRole("link", { name: names[0], exact: true }).click();
  await action(page, "Edit name and description");
  const panel = page.getByRole("region", { name: "Edit name and description" });
  await panel.getByRole("textbox", { name: "Description" }).fill("For Alpha only");
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { resume = resolve; });
  await page.route("**/api/personas/read", async (route) => {
    await waiting;
    await route.continue();
  });
  await page.getByRole("link", { name: names[1], exact: true }).click();
  try {
    await expect(panel).toHaveCount(0);
  } finally {
    resume();
  }
  await expect(page.getByRole("heading", { name: names[1], exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  const beta = await (await request.post("/api/personas/read", { data: { ref: refs[1] } })).json();
  expect(beta.definition.name).toBe(names[1]);
  expect(beta.definition.description).toBeUndefined();
});

async function openRef(page: Page, ref: unknown) {
  await collection(page);
  await page
    .getByRole("textbox", { name: "Search personas", exact: true })
    .fill("");
  const row = page
    .locator("[data-persona-key]")
    .filter({ has: page.locator("span") });
  await expect
    .poll(async () =>
      row.evaluateAll(
        (elements, key) =>
          elements.some((e) => e.getAttribute("data-persona-key") === key),
        JSON.stringify(ref),
      ),
    )
    .toBe(true);
  const index = await row.evaluateAll(
    (elements, key) =>
      elements.findIndex((e) => e.getAttribute("data-persona-key") === key),
    JSON.stringify(ref),
  );
  await row.nth(index).click();
}

test("real persona editor persists ordered text/files, inheritance/overrides and native skill support reads", async ({
  page,
  request,
}, info) => {
  const suffix = Date.now().toString(36),
    base = `Base ${suffix}`,
    child = `Writer ${suffix}`;
  await page.goto("/#/persona");
  await createPersona(page, base);
  await addPrompt(page, "Base tone");
  await reference(page, 1, "tone");
  await addPrompt(page, "Exclude this inherited entry");
  await reference(page, 2, "extra");
  await save(page);
  await addFile(page);
  await reference(page, 3, "rules");
  await editFile(page, 3);
  await page
    .getByRole("textbox", { name: "File text: rules.md", exact: true })
    .fill("File rules persisted separately");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^File saved\.$/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await resourceAction(page, "Instruction", 3, "Move up");
  await expect(
    page.getByRole("button", { name: "Prompt 2 actions", exact: true }),
  ).toBeFocused();
  await save(page);
  await editFile(page, 2);
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
  await createPersona(page, child);
  await addParent(page, base);
  await addParent(page, "Test review library");
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
  await action(page, "Preview");
  await page
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Customize Base tone", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Child tone override");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await save(page);
  await action(page, "Preview");
  await page
    .getByRole("button", {
      name: "Don’t use File rules edited with its own revision",
      exact: true,
    })
    .click();
  await page.keyboard.press("Escape");
  await save(page);
  await page.getByText("View JSON", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Persona JSON", exact: true }),
  ).toContainText("replace");
  await page.keyboard.press("Escape");
  await page.reload();
  await openPersona(page, child);
  await expect(
    page
      .locator("[data-instructions] .prompt-text")
      .filter({ hasText: "Child tone override" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Persona: No persona", exact: true })
    .click();
  await page
    .getByRole("listbox", { name: "Persona", exact: true })
    .getByRole("option", { name: child, exact: true })
    .click();
  const context = page.getByRole("button", {
    name: `Persona: ${child}`,
    exact: true,
  });
  await context.click();
  await page.locator("[data-selector-popup] summary").click();
  await page.getByRole("button", { name: /^Chat setup:/ }).click();
  await page
    .getByRole("option", { name: "Catalog resources", exact: true })
    .click();
  await expect(
    page.getByText(
      "Skills need file access, which this chat setup doesn’t allow.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Chat setup:/ }).click();
  await page
    .getByRole("option", { name: "Test-only deterministic", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(context).toBeFocused();
  await page
    .getByRole("textbox", { name: "Ask anything", exact: true })
    .fill("read-skill-support");
  await page
    .getByRole("textbox", { name: "Ask anything", exact: true })
    .press("Enter");
  await expect(page.getByText(/local:.*NATIVE-COPIED-SUPPORT/)).toBeVisible();
  await expect(page.getByText(/Admitted persona:/)).toHaveCount(0);
  await page.getByRole("button", { name: "Chat info", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Chat info", exact: true }),
  ).toContainText(child);
  await capture(page, info, "inherited-chat-info");
  await page.keyboard.press("Escape");
  const { sessions } = await (await request.get("/api/sessions")).json();
  expect(
    sessions.find(
      (s: { persona?: { name: string } }) => s.persona?.name === child,
    ).persona.name,
  ).toBe(child);
  await page.getByRole("button", { name: "Chat info", exact: true }).click();
  await page.getByRole("button", { name: "Stop agent", exact: true }).click();
});

test("real stale save keeps editor draft and route navigation keeps unsaved file drafts", async ({
  page,
  request,
}) => {
  const name = `Conflict ${Date.now()}`;
  await page.goto("/#/persona");
  await createPersona(page, name);
  await addFile(page);
  const ref = await refFor(request, name);
  const saved = await (
    await request.post("/api/personas/read", { data: { ref } })
  ).json();
  expect(
    (
      await request.post("/api/personas/save", {
        data: {
          ref,
          expectedRevision: saved.revision,
          definition: { ...saved.definition, description: "Other tab saved" },
        },
      })
    ).ok(),
  ).toBe(true);
  await metadata(page, "Keep my stale draft");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /This persona changed elsewhere/ }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Keep my stale draft");
  await editFile(page);
  await page
    .getByRole("textbox", { name: "File text: rules.md" })
    .fill("Unsaved separate file draft");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Personas", exact: true }),
  ).toBeVisible();
  await openPersona(page, name);
  await editFile(page);
  await expect(
    page.getByRole("textbox", { name: "File text: rules.md" }),
  ).toHaveValue("Unsaved separate file draft");
  await expect(page.getByRole("main")).toContainText("Keep my stale draft");
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
    await openRef(page, item.ref);
    const diagnostics = page.getByRole("region", {
      name: "Catalog diagnostics",
    });
    await expect(diagnostics).toContainText(`examples/${path}`);
    await diagnostics.getByText("Details", { exact: true }).click();
    await expect(diagnostics).toContainText(item.diagnostics[0].code);
    await expect(
      page.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    if (["malformed-one", "malformed-two", "unsupported"].includes(path))
      await expect(diagnostics).toContainText("has not been reconstructed");
    else
      await expect(
        page.getByRole("button", { name: "Add prompt", exact: true }),
      ).toBeDisabled();
  }
  expect(invalidReads).toBe(0);
  await capture(page, info, "invalid");
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
      await page.goto("/#/persona");
      await openPersona(page, child.definition.name);
      const other = await context.newPage();
      const target = graph === "parent" ? parent : child;
      try {
        await other.goto("/#/persona");
        await openPersona(other, target.definition.name);
        await metadata(other, "Other tab durable update");
        await save(other);
        await metadata(page, "Keep my stale definition draft");
        if (newFile) {
          await resourceAction(page, "Instruction", 1, "Advanced settings");
          await page
            .getByRole("textbox", { name: "File name", exact: true })
            .fill("new-rules.md");
          await page.getByRole("button", { name: "Done", exact: true }).click();
        }
        await editFile(page);
        if (!newFile)
          await page
            .getByRole("button", { name: "Load file", exact: true })
            .click();
        await page
          .getByRole("textbox", {
            name: `File text: ${newFile ? "new-rules.md" : "rules.md"}`,
            exact: true,
          })
          .fill("File save still succeeds");
        await page
          .getByRole("button", { name: "Save file", exact: true })
          .click();
        await expect(
          page.getByRole("status").filter({ hasText: /^File saved\.$/ }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("alert").filter({
            hasText: /The file was saved, but this persona changed elsewhere/,
          }),
        ).toBeVisible();
        await expect(page.getByRole("main")).toContainText(
          "Keep my stale definition draft",
        );
        await editFile(page);
        await expect(
          page.getByRole("textbox", {
            name: `File text: ${newFile ? "new-rules.md" : "rules.md"}`,
            exact: true,
          }),
        ).toHaveValue("File save still succeeds");
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("button", { name: "Save changes", exact: true }),
        ).toBeDisabled();
        expect(
          (await post("read", { ref: target.ref })).definition.description,
        ).toBe("Other tab durable update");
        expect(
          (
            await request.post("/api/personas/save", {
              data: {
                ref: child.ref,
                expectedRevision: child.revision,
                definition: {
                  ...child.definition,
                  description: "Stale overwrite",
                },
              },
            })
          ).status(),
        ).toBe(409);
        if (graph === "parent" && newFile)
          await capture(page, info, "reconciliation");
      } finally {
        await other.close();
      }
    });
  }

test("ordinary collection/continuous/dialog journey uses checked preview, real settings and actual native title tool", async ({
  page,
  request,
}, info) => {
  const name = `Simple writer ${Date.now().toString(36)}`;
  await page.goto("/#/persona");
  await capture(page, info, "collection");
  await page.getByRole("button", { name: "New persona", exact: true }).click();
  await capture(page, info, "create-dialog");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "New persona", exact: true }),
  ).toBeFocused();
  await createPersona(page, name);
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveCount(0);
  await addPrompt(page, "Explain things simply.");
  await expect(
    page.getByRole("textbox", { name: "Reference name", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await capture(page, info, "continuous-prompts");
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  await capture(page, info, "skill-dialog");
  await page.keyboard.press("Escape");
  await capture(page, info, "continuous-skills");
  await action(page, "Preview");
  await expect(
    page.getByRole("status").filter({ hasText: "Checked draft" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Checked draft" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await save(page);
  const ref = await refFor(request, name);
  const saved = await (
    await request.post("/api/personas/read", { data: { ref } })
  ).json();
  expect(saved.definition.instructions).toEqual([
    { id: "instruction-1", text: "Explain things simply." },
  ]);
  await action(page, "Edit name and description");
  await capture(page, info, "metadata-dialog");
  await page.keyboard.press("Escape");
  await page.goto("/#/settings");
  await expect(
    page.getByRole("main").getByRole("radiogroup", { name: "Theme" }),
  ).toBeVisible();
  const catalog = await (await request.get("/api/catalog")).json();
  for (const folder of catalog.workspaces)
    await expect(
      page.getByRole("main").getByText(folder.label, { exact: true }),
    ).toBeVisible();
  await capture(page, info, "general");
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(
    page.getByText(/Source connections aren’t available yet/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Add Source|Sync/ }),
  ).toHaveCount(0);
  await capture(page, info, "sources");
  await page
    .getByRole("button", { name: "Persona: No persona", exact: true })
    .click();
  await page.getByRole("option", { name, exact: true }).click();
  await page
    .getByRole("textbox", { name: "Ask anything", exact: true })
    .fill('title:{"title":"Planning a quiet workspace"}');
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Planning a quiet workspace",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Planning a quiet workspace/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  const ordinary = await page.getByRole("main").innerText();
  expect(ordinary).not.toMatch(/Admitted|Queued:|idle|Live|Connected/);
  expect(ordinary).not.toContain(ref.id);
  expect(ordinary).not.toContain(saved.revision);
  await capture(page, info, "named-chat");
  await page.getByRole("button", { name: "Chat info", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Chat info", exact: true });
  for (const field of ["Persona", "Model", "Working folder", "Started"])
    await expect(dialog.getByText(field, { exact: true })).toBeVisible();
  expect(await dialog.innerText()).not.toMatch(
    /Chat ID|Revision|History window|Queue|idle|Live|\{"root/,
  );
  expect(await dialog.innerText()).not.toContain(saved.revision);
  await capture(page, info, "chat-info");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Chat info", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Chat info", exact: true }).click();
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
  await openPersona(page, child.definition.name);
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
    await openPersona(other, parent.definition.name);
    await addPrompt(other, "Newly inherited instruction");
    await save(other);
    await action(page, "Reload saved version");
    const added = page.getByRole("checkbox", {
      name: "1 · instructions · Newly inherited instruction",
      exact: true,
    });
    // Reload replaces the draft, so the card may come back collapsed.
    const choices = page.getByRole("button", { name: "Choose what to use", exact: true });
    await expect(choices).toBeVisible();
    if ((await choices.getAttribute("aria-expanded")) !== "true") await choices.click();
    await expect(added).toBeChecked();
    await page
      .getByRole("checkbox", {
        name: "1 · instructions · Old inherited instruction",
        exact: true,
      })
      .uncheck();
    await expect(added).toBeChecked();
    await capture(page, info, "reloaded-choices", [390, 1920]);
    await save(page);
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

test("busy creation protects inputs and explicit collection navigation supersedes delayed completion", async ({
  page,
  request,
}, info) => {
  const original = `Original editor ${Date.now()}`;
  await page.goto("/#/persona");
  await createPersona(page, original);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    entering = new Promise<void>((r) => (entered = r));
  await page.route("**/api/personas/create", async (route) => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  const created = `Created elsewhere ${Date.now()}`;
  await collection(page);
  await page.getByRole("button", { name: "New persona", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(created);
  await page
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  await entering;
  await expect(page.locator(".inline-panel")).toHaveAttribute("aria-busy", "true");
  await expect(
    page.getByRole("button", { name: /Create persona$/ }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-panel")).toBeVisible();
  // Deliberate route navigation can supersede in-flight work even though the modal prevents accidental underlying edits.
  await page.evaluate(() => (window.location.hash = "/sources"));
  await expect(
    page.getByRole("heading", { name: "Sources", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Personas", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("main").getByRole("button", { name: created, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Personas", exact: true }),
  ).toBeVisible();
  await openPersona(page, original);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await refFor(request, created)).toBeTruthy();
  await capture(page, info, "superseded-create", [390, 1920]);
});

test("duplicate empty persona files show identity repair copy with closed technical Details", async ({
  page,
}, info) => {
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
  for (const item of personas) {
    await openRef(page, item.ref);
    const region = page.getByRole("region", { name: "Catalog diagnostics" });
    await expect(
      region.getByText(
        "These persona files share the same identity. Fix the duplicate files to continue.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(region.locator("details")).not.toHaveAttribute("open", "");
    await expect(region).toContainText(`examples/${item.ref.path}`);
    await region.getByText("Details", { exact: true }).click();
    await expect(region).toContainText(item.ref.id);
    await region.getByText("Details", { exact: true }).click();
  }
  await capture(page, info, "duplicate-identity", [390, 1920]);
});

test("32 dirty file drafts block a new editor with visible recovery copy and preserve the first draft", async ({
  page,
}, info) => {
  await page.goto("/#/persona");
  await createPersona(page, `Draft capacity ${Date.now()}`);
  await addFile(page);
  const repair = async (name: string) => {
    await resourceAction(page, "Instruction", 1, "Advanced settings");
    await page
      .getByRole("textbox", { name: "File name", exact: true })
      .fill(name);
    await page.getByRole("button", { name: "Done", exact: true }).click();
  };
  for (let i = 0; i < 32; i++) {
    await repair(`draft-${i}.md`);
    await editFile(page);
    await page
      .getByRole("textbox", { name: `File text: draft-${i}.md`, exact: true })
      .fill(`Retained file draft ${i}`);
    await page.keyboard.press("Escape");
  }
  await repair("blocked.md");
  await editFile(page);
  const reason = page.getByRole("alert").filter({
    hasText:
      "Too many files have unsaved changes. Save one, then reopen this file.",
  });
  await expect(reason).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "File text: blocked.md", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save file", exact: true }),
  ).toBeDisabled();
  await expect(reason.locator("..").locator("details")).not.toHaveAttribute(
    "open",
    "",
  );
  await capture(page, info, "draft-capacity", [390, 1920]);
  await page.keyboard.press("Escape");
  await repair("draft-0.md");
  await editFile(page);
  await expect(
    page.getByRole("textbox", { name: "File text: draft-0.md", exact: true }),
  ).toHaveValue("Retained file draft 0");
});

test("creation error retains dialog fields, no fake saved row, and empty/search states are truthful", async ({
  page,
}, info) => {
  // Presentation-only empty catalog fixture; no installed examples or fake durable row.
  await page.route("**/api/personas", (route) =>
    route.fulfill({ json: { personas: [] } }),
  );
  await page.route("**/api/personas/create", (route) =>
    route.fulfill({ status: 500, json: { error: "storage" } }),
  );
  await page.goto("/#/persona");
  await expect(
    page.getByText(
      "Create a persona to give your chats a reusable set of instructions and skills.",
      { exact: true },
    ),
  ).toBeVisible();
  await capture(page, info, "empty-collection");
  await page.getByRole("button", { name: "New persona", exact: true }).click();
  const dialog = page.locator(".inline-panel");
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Keep creation draft");
  await dialog
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Keep description");
  await dialog
    .getByRole("button", { name: "Create persona", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Couldn’t save the changes.",
  );
  await expect(
    dialog.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Keep creation draft");
  await expect(
    dialog.getByRole("textbox", { name: "Description", exact: true }),
  ).toHaveValue("Keep description");
  await expect(
    page.getByRole("heading", { name: "Keep creation draft", exact: true }),
  ).toHaveCount(0);
  await capture(page, info, "create-failure", [390, 1920]);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "New persona", exact: true }),
  ).toBeFocused();
});

test("preview failure keeps draft and saved identity; collection refresh/search and same-hash Manage resume it", async ({
  page,
  request,
}) => {
  const name = `Checked draft ${Date.now()}`;
  await page.goto("/#/persona");
  await createPersona(page, name);
  await addPrompt(page, "Keep this text");

  await reference(page, 1, "NOT valid");
  await action(page, "Preview");
  await page
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  const dialog = page.locator(".inline-panel");
  await expect(dialog.getByRole("alert")).toHaveText(
    "Check this persona’s name, instructions, and skills.",
  );
  await expect(dialog.getByRole("status")).toHaveText("Changes not checked");
  await dialog.getByText("Details", { exact: true }).first().click();
  await expect(dialog).toContainText("invalid-definition");
  await page.keyboard.press("Escape");
  await collection(page);
  await page
    .getByRole("textbox", { name: "Search personas", exact: true })
    .fill("NO MATCHING PERSONA");
  await expect(
    page.getByText("No matching personas.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Personas", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Manage personas", exact: true })
    .last()
    .click();
  await openPersona(page, name);
  await expect(
    page
      .locator("[data-instructions] .prompt-text")
      .filter({ hasText: "Keep this text" }),
  ).toBeVisible();
  await reference(page, 1, "instruction-1");
  await save(page);
  await action(page, "Edit name and description");
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Draft-only name");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Draft-only name", exact: true }),
  ).toBeVisible();
  expect(await refFor(request, name)).toBeTruthy();
  await collection(page);
  await page
    .getByRole("textbox", { name: "Search personas", exact: true })
    .fill(name);
  await expect(
    page
      .getByRole("main")
      .getByRole("button", { name: new RegExp(`^${name}`) }),
  ).toContainText("Unsaved changes");
});

test("Based on expert tokens preserve unknown draft references, validate custom names, and checkboxes keep all/none/subset", async ({
  page,
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
      name: `Token base ${Date.now()}`,
      instructions: [
        { id: "one", text: "Known rule" },
        { id: "two", text: "Other rule" },
      ],
    },
  });
  const child = await post("create", {
    definition: {
      schemaVersion: 1,
      name: `Token child ${Date.now()}`,
      parents: [{ ...parent.ref, include: { instructions: ["one"] } }],
    },
  });
  await page.goto("/#/persona");
  await openPersona(page, child.definition.name);
  await page.getByText("Choose what to use", { exact: true }).click();
  await expect(
    page.getByRole("checkbox", {
      name: "1 · instructions · Known rule",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: "1 · instructions · Other rule",
      exact: true,
    }),
  ).not.toBeChecked();
  // Extra references are typed straight into the expanded card: no separate panel.
  const tokens = page.getByRole("group", {
    name: "More prompts by reference name",
    exact: true,
  });
  const custom = tokens.getByRole("combobox");
  await custom.fill("NOT valid");
  await custom.press("Enter");
  await expect(tokens.getByRole("alert")).toBeVisible();
  await custom.fill("unknown");
  await custom.press("Enter");
  await expect(
    tokens.getByRole("button", { name: "Remove unknown", exact: true }),
  ).toBeVisible();
  await expect(tokens).toContainText("Unavailable");
  await action(page, "Preview");
  await page
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  await expect(page.locator(".inline-panel").getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tokens).toContainText("unknown");
  await capture(page, info, "reference-tokens", [390, 1920]);
  await tokens
    .getByRole("button", { name: "Remove unknown", exact: true })
    .focus();
  await page.keyboard.press("Delete");
  await expect(custom).toBeFocused();
  await page
    .getByRole("checkbox", {
      name: "1 · instructions · Known rule",
      exact: true,
    })
    .uncheck();
  await save(page);
  let saved = await post("read", { ref: child.ref });
  expect(saved.definition.parents[0].include.instructions).toEqual([]);
  await page
    .getByRole("checkbox", {
      name: "1 · instructions · Known rule",
      exact: true,
    })
    .check();
  await save(page);
  saved = await post("read", { ref: child.ref });
  expect(saved.definition.parents[0].include.instructions).toEqual(["one"]);
  await page
    .getByRole("checkbox", {
      name: "1 · instructions · Other rule",
      exact: true,
    })
    .check();
  await save(page);
  saved = await post("read", { ref: child.ref });
  expect(saved.definition.parents[0].include?.instructions).toBeUndefined();
});

test("file save marks last preview stale; explicit check refreshes text and independent save revision stays guarded", async ({
  page,
  request,
}) => {
  const name = `File preview ${Date.now()}`;
  await page.goto("/#/persona");
  await createPersona(page, name);
  await addFile(page);
  await editFile(page);
  const file = page.getByRole("textbox", {
    name: "File text: rules.md",
    exact: true,
  });
  await file.fill("Old saved file preview");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^File saved\.$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load file", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await action(page, "Reload saved version");
  await expect(page.getByText("Loading persona…", { exact: true })).toHaveCount(
    0,
  );
  await action(page, "Preview");
  await expect(page.locator(".inline-panel").getByRole("status")).toHaveText(
    "Saved version",
  );
  await page.keyboard.press("Escape");
  await editFile(page);
  await file.fill("New saved file preview");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^File saved\.$/ }),
  ).toBeVisible();
  const ref = await refFor(request, name);
  const before = await (
    await request.post("/api/personas/read", { data: { ref } })
  ).json();
  await page.keyboard.press("Escape");
  await action(page, "Preview");
  const dialog = page.locator(".inline-panel");
  await expect(dialog.getByRole("status")).toHaveText("Changes not checked");
  await expect(dialog).toContainText("Old saved file preview");
  await dialog
    .getByRole("button", { name: "Check changes", exact: true })
    .click();
  await expect(dialog).toContainText("New saved file preview");
  await expect(dialog.getByRole("status")).toHaveText("Saved version");
  await page.keyboard.press("Escape");
  expect(
    (await (await request.post("/api/personas/read", { data: { ref } })).json())
      .revision,
  ).toBe(before.revision);
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await action(page, "Reload saved version");
  await action(page, "Preview");
  await expect(page.locator(".inline-panel").getByRole("status")).toHaveText(
    "Saved version",
  );
});

test("actual Advanced and local Preview disclosures support native keyboard traversal", async ({
  page,
}, info) => {
  await page.goto("/#/persona");
  await createPersona(page, `Keyboard disclosures ${Date.now().toString(36)}`);
  await addPrompt(page, "Local keyboard instruction");

  await save(page);
  const trigger = page.getByRole("button", {
    name: "Persona actions",
    exact: true,
  });
  // Advanced is an in-page section: its disclosures use native keyboard behavior.
  const advanced = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Advanced", exact: true }) });
  const definition = advanced
    .locator("summary")
    .filter({ hasText: /^Definition details$/ });
  const json = advanced.locator("summary").filter({ hasText: /^View JSON$/ });
  await definition.focus();
  await page.keyboard.press("Enter");
  await expect(advanced.getByText("Persona ID", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(advanced.getByText("Persona ID", { exact: true })).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(json).toBeFocused();
  await page.keyboard.press("Space");
  await expect(
    advanced.getByRole("region", { name: "Persona JSON" }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    advanced.getByRole("region", { name: "Persona JSON" }),
  ).toBeHidden();
  await page.keyboard.press("Shift+Tab");
  await expect(definition).toBeFocused();
  await page.keyboard.press("Enter");
  await capture(page, info, "keyboard-advanced");
  await page.keyboard.press("Enter");

  await action(page, "Preview");
  const preview = page.getByRole("region", {
    name: "Persona preview",
    exact: true,
  });
  const previewClose = preview.getByRole("button", {
    name: "Close Persona preview",
    exact: true,
  });
  const check = preview.getByRole("button", {
    name: "Check changes",
    exact: true,
  });
  const text = preview
    .locator("summary")
    .filter({ hasText: /^Instruction text$/ });
  const details = preview.locator("summary").filter({ hasText: /^Details$/ });
  // The panel takes focus on its close control; Tab moves through it in page order.
  await expect(previewClose).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(text).toBeFocused();
  await page.keyboard.press("Space");
  await expect(
    preview.getByText("Local keyboard instruction", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    preview.getByText("Local keyboard instruction", { exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(details).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    preview.getByText("Reference name", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await expect(
    preview.getByText("Reference name", { exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(
    preview.getByRole("button", { name: "Close preview", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(check).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(details).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(text).toBeFocused();
  await page.keyboard.press("Space");
  await capture(page, info, "keyboard-local-preview");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("retained file changes stay attributed to their persona while a clean different persona is held", async ({
  page,
  request,
}, info) => {
  const suffix = Date.now().toString(36);
  const a = `Retained file A ${suffix}`,
    b = `Clean B ${suffix}`;
  await page.goto("/#/persona");
  await createPersona(page, b);
  const bRef = await refFor(request, b);
  await createPersona(page, a);
  const aRef = await refFor(request, a);
  await addFile(page);
  await editFile(page);
  const contents = page.getByRole("textbox", {
    name: "File text: rules.md",
    exact: true,
  });
  await contents.fill("Saved A contents");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^File saved\.$/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await action(page, "Reload saved version");
  await editFile(page);
  await contents.fill("Retained A unsaved contents");
  await collection(page);
  const row = (ref: unknown) =>
    page.locator("[data-persona-key]").filter({
      has: page.locator("span.font-medium", { hasText: ref === aRef ? a : b }),
    });
  await expect(row(aRef)).toContainText("Unsaved changes");
  let confirmations = 0;
  page.on("dialog", async (dialog) => {
    expect(dialog.message()).toBe(
      "Leave unsaved instruction file text? Your file drafts will stay here.",
    );
    confirmations++;
    await dialog.accept();
  });
  await openRef(page, bRef);
  await expect(
    page.getByRole("heading", { name: b, exact: true }),
  ).toBeVisible();
  expect(confirmations).toBe(1);
  await collection(page);
  await expect(row(aRef)).toContainText("Unsaved changes");
  await expect(row(bRef)).not.toContainText("Unsaved changes");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("Loading personas…", { exact: true }),
  ).toHaveCount(0);
  await expect(row(aRef)).toContainText("Unsaved changes");
  await expect(row(bRef)).not.toContainText("Unsaved changes");
  await capture(page, info, "retained-a-clean-b-collection");
  await openRef(page, aRef);
  await expect(
    page.getByRole("heading", { name: a, exact: true }),
  ).toBeVisible();
  expect(confirmations).toBe(2);
  await editFile(page);
  await expect(contents).toHaveValue("Retained A unsaved contents");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^File saved\.$/ }),
  ).toBeVisible();
  const saved = await (
    await request.post("/api/personas/instruction/read", {
      data: { ref: aRef, path: "rules.md" },
    })
  ).json();
  expect(saved.text).toBe("Retained A unsaved contents");
  await collection(page);
  await expect(row(aRef)).not.toContainText("Unsaved changes");
  await expect(row(bRef)).not.toContainText("Unsaved changes");
  await openRef(page, bRef);
  await expect(
    page.getByRole("heading", { name: b, exact: true }),
  ).toBeVisible();
  await metadata(page, "Held definition draft");
  await collection(page);
  await expect(row(aRef)).not.toContainText("Unsaved changes");
  await expect(row(bRef)).toContainText("Unsaved changes");
});
