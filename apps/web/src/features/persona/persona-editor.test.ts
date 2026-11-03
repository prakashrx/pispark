import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import { afterEach, expect, test, vi } from "vitest";
import App from "../../App.svelte";
import type { PersonaView } from "../../../../server/src/persona-protocol";
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
  const select = screen.getByRole("combobox", { name: "Edit persona" });
  await waitFor(() => expect(select.querySelectorAll("option").length).toBe(2));
  await fireEvent.change(select, { target: { value: JSON.stringify(ref) } });
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "Instruction 1 text",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe("First");
  await fireEvent.click(
    screen.getByRole("button", { name: "Move instruction 2 up" }),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Instruction 1 text",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Second");
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: "Save Persona" }));
  await waitFor(() =>
    expect(screen.getByText("Saved", { exact: true })).toBeTruthy(),
  );
  expect(screen.queryByRole("button", { name: "Add Extension" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit /review" })).toBeNull();
});
test("read-only source renders actual fields but cannot save or remove resources", async () => {
  setup(false);
  const select = screen.getByRole("combobox", { name: "Edit persona" });
  await waitFor(() => expect(select.querySelectorAll("option").length).toBe(2));
  await fireEvent.change(select, { target: { value: JSON.stringify(ref) } });
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "Display Name",
      })) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Save Persona" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Remove instruction 1",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("malformed and unsupported catalog selections keep original diagnostics and never request invalid documents", async () => {
  const entries = ["broken-one", "broken-two", "future"].map((path, i) => ({
    ref: { root: "examples", path, id: i === 2 ? ref.id : "" },
    name: "Invalid persona",
    writable: false,
    valid: false,
    diagnostics: [
      { code: i === 2 ? "unsupported-version" : "invalid-definition" },
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
  const select = screen.getByRole("combobox", { name: "Edit persona" });
  await waitFor(() => expect(select.querySelectorAll("option").length).toBe(4));
  for (const item of entries) {
    await fireEvent.change(select, {
      target: { value: JSON.stringify(item.ref) },
    });
    expect(
      screen.getByRole("region", { name: "Catalog diagnostics" }).textContent,
    ).toContain(`examples/${item.ref.path}`);
    expect(
      screen.getByRole("region", { name: "Catalog diagnostics" }).textContent,
    ).toContain(item.diagnostics[0]!.code);
    expect(screen.queryByRole("textbox", { name: "Display Name" })).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Save Persona",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  }
  expect(fetch.mock.calls.some(([url]) => url.endsWith("/personas/read"))).toBe(
    false,
  );
});
