import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../../App.svelte";
import type { PersonaView } from "../../../../server/src/persona-protocol";
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
});
const ref = {
  root: "managed",
  path: "10000000-0000-4000-8000-000000000001",
  id: "10000000-0000-4000-8000-000000000001",
};
function setup(writable = true) {
  let view: PersonaView = {
    ref,
    definition: {
      schemaVersion: 1,
      id: ref.id,
      name: "Actual writer",
      instructions: [
        { id: "one", text: "First" },
        { id: "two", text: "Second" },
      ],
    },
    writable,
    revision: "a".repeat(64),
    definitionRevision: "a".repeat(64),
    effectiveRevision: "a".repeat(64),
    instructions: [],
    skills: [],
    excluded: [],
    diagnostics: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      let result: unknown =
        url === "/api/catalog"
          ? { workspaces: [], configurations: [] }
          : url === "/api/providers"
            ? { providers: [], defaultModel: null, networkBlocked: false }
            : { sessions: [], truncated: false };
      if (url === "/api/personas")
        result = {
          personas: [
            {
              ref,
              name: view.definition.name,
              valid: true,
              writable,
              revision: view.revision,
              diagnostics: [],
            },
          ],
        };
      if (url === "/api/personas/read") result = view;
      if (url === "/api/personas/validate")
        result = { ...view, definition: body.definition };
      if (url === "/api/personas/save") {
        view = {
          ...view,
          definition: body.definition,
          revision: "b".repeat(64),
        };
        result = view;
      }
      return new Response(JSON.stringify(result));
    }),
  );
  window.location.hash = "/persona";
  render(App);
}
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

test("editor orders supported instruction cards, saves only on response and removes fake capability controls", async () => {
  setup();
  await fireEvent.click(
    await screen.findByRole("button", { name: /^Actual writer/ }),
  );
  await screen.findByText("First", { exact: true });
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.queryByRole("button", { name: "Back to personas" })).toBeNull();
  expect(
    [...document.querySelectorAll("section[data-layout=split] h2")].map(
      (e) => e.textContent,
    ),
  ).toEqual(["Reuse personas", "Prompts", "Skills", "Advanced"]);
  expect(screen.queryByRole("textbox", { name: "Instructions" })).toBeNull();
  await fireEvent.click(
    screen.getByRole("button", { name: "Prompt 2 actions" }),
  );
  await fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
  expect(
    document.querySelector("[data-instructions] .prompt-text")!.textContent,
  ).toBe("Second");
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(screen.getByText("Saved", { exact: true })).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: "Add Extension" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit /review" })).toBeNull();
});
test("read-only source renders actual fields but cannot save or remove resources", async () => {
  setup(false);
  await fireEvent.click(
    await screen.findByRole("button", { name: /^Actual writer/ }),
  );
  await screen.findByText("First", { exact: true });
  await fireEvent.click(
    screen.getAllByRole("button", { name: "Read prompt" })[0]!,
  );
  expect(screen.getByRole("document").textContent).toContain("First");
  expect(screen.queryByRole("button", { name: /^Edit$/ })).toBeNull();
  await fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
  expect(
    (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await fireEvent.click(
    await screen.findByRole("button", { name: "Prompt 1 actions" }),
  );
  expect(
    (screen.getByRole("menuitem", { name: "Remove" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test("malformed and unsupported catalog selections keep original diagnostics and never request invalid documents", async () => {
  const entries = ["broken-one", "broken-two", "future"].map((path, i) => ({
    ref: { root: "examples", path, id: i === 2 ? ref.id : "" },
    name: "Invalid persona",
    writable: false,
    valid: false,
    diagnostics: [
      {
        code: i === 2 ? "unsupported-version" : "invalid-definition",
        field: "definition.name",
        resourceId: `resource-${i}`,
      },
    ],
  }));
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === "/api/personas"
            ? { personas: entries }
            : url === "/api/catalog"
              ? { workspaces: [], configurations: [] }
              : url === "/api/providers"
                ? { providers: [], defaultModel: null, networkBlocked: false }
                : { sessions: [], truncated: false },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  window.location.hash = "/persona";
  render(App);
  await waitFor(() =>
    expect(document.querySelectorAll("[data-persona-key]").length).toBe(3),
  );
  for (const item of entries) {
    const row = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-persona-key]"),
    ].find(
      (el) => el.getAttribute("data-persona-key") === JSON.stringify(item.ref),
    )!;
    await fireEvent.click(row);
    expect(
      screen.getByRole("region", { name: "Catalog diagnostics" }).textContent,
    ).toContain(`examples/${item.ref.path}`);
    expect(
      screen.getByRole("region", { name: "Catalog diagnostics" }).textContent,
    ).toContain(item.diagnostics[0]!.code);
    const details = screen
      .getByRole("region", { name: "Catalog diagnostics" })
      .querySelector("details")!;
    expect(details.textContent).toContain(item.diagnostics[0]!.resourceId);
    expect(details.textContent).toContain("definition.name");
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(screen.queryByText(/Your edits are still here/)).toBeNull();
    if (item.diagnostics[0]!.code === "invalid-definition")
      expect(screen.getByRole("alert").textContent).toBe(
        "This persona’s file isn’t valid. Fix the original file to continue.",
      );
    expect(
      screen
        .getByRole("region", { name: "Catalog diagnostics" })
        .querySelector("details")!.open,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Save changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await fireEvent.click(
      screen.getAllByRole("link", { name: "Manage personas" }).at(-1)!,
    );
  }
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/personas/read"))).toBe(
    false,
  );
});

test("file draft capacity has an actionable primary alert with closed Details and keeps all dirty drafts blocked safely", async () => {
  const { PersonaClient } = await import("./persona-client.svelte");
  const { default: InstructionFile } = await import("./InstructionFile.svelte");
  const client = new PersonaClient();
  for (let i = 0; i < 32; i++)
    client.file(ref, `${i}.md`).content = `Draft ${i}`;
  render(InstructionFile, {
    reference: ref,
    path: "blocked.md",
    client,
    declared: false,
  });
  const reason = screen.getByText(
    "Too many files have unsaved changes. Save one, then reopen this file.",
    { exact: true },
  );
  expect(reason.getAttribute("role")).toBe("alert");
  expect(reason.closest("details:not([open])")).toBeNull();
  const diagnostic = screen.getByText("file-draft-limit", { exact: true });
  expect(diagnostic.closest("details")!.open).toBe(false);
  expect(
    (
      screen.getByRole("textbox", {
        name: "File text: blocked.md",
      }) as HTMLTextAreaElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Save file" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  for (let i = 0; i < 32; i++)
    expect(client.file(ref, `${i}.md`).content).toBe(`Draft ${i}`);
});

test("private Add/Edit/Cancel never mutate a definition or save early; same target resumes after route pause", async () => {
  setup();
  await fireEvent.click(
    await screen.findByRole("button", { name: /^Actual writer/ }),
  );
  await fireEvent.click(
    await screen.findByRole("button", { name: "Prompt 1 actions" }),
  );
  await fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
  await fireEvent.input(screen.getByRole("textbox", { name: "Instructions" }), {
    target: { value: "Private unapplied" },
  });
  // The row being edited shows its editor; no row shows the private text.
  expect(
    Array.from(
      document.querySelectorAll("[data-instructions] .prompt-text"),
      (row) => row.textContent?.trim(),
    ),
  ).not.toContain("Private unapplied");
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await fireEvent.click(screen.getByRole("link", { name: "Sources" }));
  await screen.findByRole("heading", { name: "Sources" });
  await fireEvent.click(
    screen.getAllByRole("link", { name: "Manage personas" }).at(-1)!,
  );
  await fireEvent.click(
    await screen.findByRole("button", { name: /^Actual writer/ }),
  );
  expect(document.querySelector(".inline-panel")).toBeNull();
  await fireEvent.click(
    await screen.findByRole("button", { name: "Prompt 1 actions" }),
  );
  await fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
  expect(
    (
      screen.getByRole("textbox", {
        name: "Instructions",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Private unapplied");
  await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("document").textContent).toContain("First");
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await fireEvent.input(screen.getByRole("textbox", { name: "Instructions" }), {
    target: { value: "Confirmed draft" },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(screen.getByRole("document").textContent).toContain("Confirmed draft");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/save")),
  ).toHaveLength(0);
  await fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(
    document.querySelector("[data-instructions] .prompt-text")!.textContent?.trim(),
  ).toBe("Confirmed draft");
  await fireEvent.click(screen.getByRole("button", { name: "Add prompt" }));
  await fireEvent.input(screen.getByRole("textbox", { name: "Instructions" }), {
    target: { value: "instructions.md" },
  });
  expect(document.querySelectorAll("[data-instructions] article")).toHaveLength(
    2,
  );
  await fireEvent.click(
    screen.getByRole("region", { name: "Add prompt" }).querySelector('button[data-variant="primary"]')!,
  );
  expect(document.querySelectorAll("[data-instructions] article")).toHaveLength(
    3,
  );
  expect(screen.getByText("instructions.md", { exact: true })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "More instruction options" }),
  ).toBeNull();
});
