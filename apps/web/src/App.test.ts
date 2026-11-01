import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, test, vi } from "vitest";
import App from "./App.svelte";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function navigate(page: string) {
  window.location.hash = `/${page}`;
  await fireEvent(window, new Event("hashchange"));
}

test("renders the supplied fixture conversation without contacting any backend", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(App);
  expect(
    screen.getByRole("heading", { name: "Workspace review" }),
  ).toBeTruthy();
  expect(screen.getByRole("main").getAttribute("aria-label")).toContain(
    "no agent or tools",
  );
  expect(
    screen.getByRole("button", { name: "Run" }).getAttribute("aria-disabled"),
  ).toBe("true");
  const ask = screen.getByRole("textbox", {
    name: "Ask anything (local draft)",
  });
  await fireEvent.input(ask, { target: { value: "Keep this draft local" } });
  await fireEvent.submit(
    screen.getByRole("form", { name: "New session draft" }),
  );
  expect((ask as HTMLInputElement).value).toBe("Keep this draft local");
  expect(
    (
      screen.getByRole("textbox", {
        name: /Reply to Workspace/,
      }) as HTMLInputElement
    ).value,
  ).toBe("");
  expect(fetch).not.toHaveBeenCalled();
});

test("collapses the sidebar and day groups; shortcut ignores editable inputs", async () => {
  render(App);
  await fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(screen.queryByText("Confirm file change")).toBeNull();
  await fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(screen.getByText("Confirm file change")).toBeTruthy();
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
  expect(
    screen.getByRole("heading", { name: "Developer Persona" }),
  ).toBeTruthy();
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

test("persona fields, prompts, commands and resource removal edit only local state", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  window.location.hash = "/persona";
  render(App);
  await fireEvent.input(screen.getByRole("textbox", { name: "Display Name" }), {
    target: { value: "My developer" },
  });
  await fireEvent.click(
    screen.getByRole("button", { name: "Add Text Prompt" }),
  );
  expect(screen.getByRole("textbox", { name: "Text Prompt" })).toBeTruthy();
  await fireEvent.click(
    screen.getByRole("button", {
      name: "Remove git-diff-checker from local draft",
    }),
  );
  expect(screen.queryByText("git-diff-checker")).toBeNull();
  await fireEvent.click(screen.getByRole("button", { name: "Edit /review" }));
  await fireEvent.input(
    screen.getByRole("textbox", { name: "/review local draft" }),
    { target: { value: "Review carefully." } },
  );
  await fireEvent.click(screen.getByRole("button", { name: "Edit /review" }));
  expect(screen.getByText("Review carefully.")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Inspect JSON" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  expect(fetch).not.toHaveBeenCalled();
});

test("keeps the mounted Ask and independent reply drafts across every route", async () => {
  render(App);
  const ask = screen.getByRole("textbox", { name: /Ask anything/ });
  await fireEvent.input(ask, { target: { value: "Global unsent question" } });
  await fireEvent.input(
    screen.getByRole("textbox", { name: /Reply to Workspace/ }),
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
        name: /Reply to Workspace/,
      }) as HTMLInputElement
    ).value,
  ).toBe("Session-only follow-up");
});
