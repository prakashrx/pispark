import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import App from "./App.svelte";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/api/catalog"
              ? { workspaces: [], configurations: [] }
              : url.startsWith("/api/personas")
                ? { personas: [] }
                : url === "/api/providers"
                  ? { providers: [], defaultModel: null, networkBlocked: false }
                  : { sessions: [], truncated: false },
          ),
        ),
    ),
  );
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function navigate(page: string) {
  window.location.hash = `/${page}`;
  await fireEvent(window, new Event("hashchange"));
}

test("renders truthful unconfigured state and never submits a draft without configuration", async () => {
  render(App);
  expect(screen.getByRole("heading", { name: "Start a session" })).toBeTruthy();
  expect(screen.getByRole("main").getAttribute("aria-label")).toContain(
    "Session conversation",
  );
  expect(
    screen.getByRole("button", { name: "Run" }).getAttribute("aria-disabled"),
  ).toBe("true");
  const ask = screen.getByRole("textbox", {
    name: "Ask anything",
  });
  await fireEvent.input(ask, { target: { value: "Keep this draft local" } });
  await fireEvent.submit(
    screen.getByRole("form", { name: "New session draft" }),
  );
  expect((ask as HTMLInputElement).value).toBe("Keep this draft local");
  expect(
    (
      screen.getByRole("textbox", {
        name: /Reply to session/,
      }) as HTMLInputElement
    ).value,
  ).toBe("");
  expect(
    vi.mocked(fetch).mock.calls.every((call) => call[1]?.method !== "POST"),
  ).toBe(true);
});

test("collapses the sidebar and session group; shortcut ignores editable inputs", async () => {
  render(App);
  await fireEvent.click(screen.getByRole("button", { name: /Sessions/ }));
  expect(screen.queryByText("No sessions yet.")).toBeNull();
  await fireEvent.click(screen.getByRole("button", { name: /Sessions/ }));
  expect(screen.getByText("No sessions yet.")).toBeTruthy();
  await fireEvent.keyDown(
    screen.getByRole("textbox", { name: /Ask anything/ }),
    { key: "b", ctrlKey: true },
  );
  expect(screen.getByRole("complementary")).toBeTruthy();
  await fireEvent.click(
    screen.getByRole("button", { name: "Collapse sidebar" }),
  );
  expect(screen.queryByRole("complementary")).toBeNull();
  await fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  expect(screen.getByRole("complementary")).toBeTruthy();
});

test("navigates among only the supplied settings pages and filters navigation", async () => {
  render(App);
  await navigate("settings");
  expect(
    screen.getByRole("heading", { name: "General", level: 1 }),
  ).toBeTruthy();
  await fireEvent.input(
    screen.getByRole("textbox", { name: "Search settings" }),
    { target: { value: "source" } },
  );
  expect(screen.getByRole("link", { name: "Sources" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /^General$/ })).toBeNull();
  await navigate("persona");
  expect(screen.getByRole("heading", { name: "Personas" })).toBeTruthy();
  await navigate("sources");
  expect(
    screen.getByRole("heading", { name: /Sources 3 active/ }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Sync all" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
});

test("general preferences change locally and reset to source defaults", async () => {
  window.location.hash = "/settings";
  render(App);
  const persona = screen.getByRole("combobox", {
    name: "Default persona",
  }) as HTMLSelectElement;
  await fireEvent.change(persona, { target: { value: "Architect" } });
  expect(persona.value).toBe("Architect");
  await fireEvent.click(
    screen.getByRole("button", { name: "Reset to defaults" }),
  );
  expect(persona.value).toBe("Developer");
  expect(
    screen
      .getByRole("button", { name: "Save changes" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
});

test("persona empty state is real and offers creation without fixture capabilities", async () => {
  window.location.hash = "/persona";
  render(App);
  expect(await screen.findByText(/No personas yet/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create persona" })).toBeTruthy();
  expect(screen.queryByText("v1.4.2")).toBeNull();
  expect(screen.queryByText("Active in session")).toBeNull();
});

test("keeps the mounted Ask and independent reply drafts across every route", async () => {
  render(App);
  const ask = screen.getByRole("textbox", { name: /Ask anything/ });
  await fireEvent.input(ask, { target: { value: "Global unsent question" } });
  await fireEvent.input(
    screen.getByRole("textbox", { name: /Reply to session/ }),
    {
      target: { value: "Session-only follow-up" },
    },
  );
  for (const route of ["settings", "persona", "sources", "workspace"]) {
    await navigate(route);
    expect(screen.getByRole("textbox", { name: /Ask anything/ })).toBe(ask);
    expect((ask as HTMLInputElement).value).toBe("Global unsent question");
    expect(
      screen.getAllByRole("form", { name: "New session draft" }),
    ).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("main"));
  }
  expect(
    (
      screen.getByRole("textbox", {
        name: /Reply to session/,
      }) as HTMLInputElement
    ).value,
  ).toBe("Session-only follow-up");
});
