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
              ? { home: "/home/me", recentFolders: [] }
              : url.startsWith("/api/personas")
                ? { personas: [] }
                : url === "/api/providers"
                  ? { providers: [], defaultModel: null, networkBlocked: false }
                  : url === "/api/schedules"
                    ? { paused: false, schedules: [] }
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
  expect(screen.getByRole("heading", { name: "New chat" })).toBeTruthy();
  expect(screen.getByRole("main").getAttribute("aria-label")).toContain(
    "Chat conversation",
  );
  expect(
    screen
      .getByRole("button", { name: "Start chat" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  const ask = screen.getByRole("textbox", {
    name: "Ask anything",
  });
  await fireEvent.input(ask, { target: { value: "Keep this draft local" } });
  await fireEvent.submit(screen.getByRole("form", { name: "New chat" }));
  expect((ask as HTMLInputElement).value).toBe("Keep this draft local");
  // With no chat open there is nothing to reply to, so Ask is the only input.
  expect(screen.queryByRole("textbox", { name: /Reply to chat/ })).toBeNull();
  expect(
    vi.mocked(fetch).mock.calls.every((call) => call[1]?.method !== "POST"),
  ).toBe(true);
});

test("collapses the sidebar and session group; shortcut ignores editable inputs", async () => {
  render(App);
  expect(screen.getByText("No chats yet.")).toBeTruthy();
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
  expect(screen.getByRole("heading", { name: /Sources/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sync all" })).toBeNull();
  expect(
    screen.getByText(/Source connections aren’t available yet/),
  ).toBeTruthy();
});

test("General applies real browser-local themes without fictional preferences, saves or environment", async () => {
  window.location.hash = "/settings";
  render(App);
  expect(
    await screen.findByText("None yet. New chats start in your home folder."),
  ).toBeTruthy();
  const themes = screen.getByRole("radiogroup", { name: "Theme" });
  expect(
    [...themes.querySelectorAll("input")].map((input) => input.value),
  ).toEqual(["system", "daylight", "paper", "mist", "midnight", "ocean", "ember"]);
  await fireEvent.click(
    themes.querySelector<HTMLInputElement>('input[value="midnight"]')!,
  );
  expect(document.documentElement.dataset.theme).toBe("midnight");
  expect(JSON.parse(localStorage.getItem("pispark.appearance")!).theme).toBe(
    "midnight",
  );
  await fireEvent.click(
    screen
      .getByRole("radiogroup", { name: "Text size" })
      .querySelector<HTMLInputElement>('input[value="large"]')!,
  );
  expect(document.documentElement.style.fontSize).toBe("17px");
  localStorage.removeItem("pispark.appearance");
  expect(
    screen
      .getAllByRole("link", { name: "Providers & models" })
      .at(-1)!
      .getAttribute("href"),
  ).toBe("#/providers");
  expect(
    screen
      .getAllByRole("link", { name: "Manage personas" })
      .at(-1)!
      .getAttribute("href"),
  ).toBe("#/persona");
  expect(
    screen.getByRole("link", { name: "Edit Default" }).getAttribute("href"),
  ).toBe("#/persona");
  expect(screen.queryByRole("combobox", { name: "Workspace font family" })).toBeNull();
  for (const name of ["Save changes", "Reset to defaults"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(
    screen.queryByText(/Git Repository|Detected runtime|Developer|Architect/),
  ).toBeNull();
});

test("persona empty state is real and offers creation without fixture capabilities", async () => {
  window.location.hash = "/persona";
  render(App);
  expect(
    await screen.findByText(/Each builds on Default/),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "New persona" })).toBeTruthy();
  expect(screen.queryByText("v1.4.2")).toBeNull();
  expect(screen.queryByText("Active in session")).toBeNull();
});

test("keeps the mounted Ask and independent reply drafts across every route", async () => {
  const base = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    url === "/api/sessions"
      ? new Response(
          JSON.stringify({
            sessions: [
              {
                id: "open-chat",
                createdAt: "2026-01-02T03:04:00Z",
                folder: "/home/me/project",
                persona: { id: "default", name: "Default", layered: false },
                status: "idle",
                interrupted: false,
              },
            ],
            truncated: false,
          }),
        )
      : String(url).startsWith("/api/sessions/open-chat/items")
        ? new Response(JSON.stringify({ items: [], head: null, more: false }))
        : url === "/api/sessions/open-chat/live"
          ? new Promise<Response>(() => {})
          : base(url, init),
  );
  render(App);
  const ask = screen.getByRole("textbox", { name: /Ask anything/ });
  await fireEvent.input(ask, { target: { value: "Global unsent question" } });
  await fireEvent.input(
    await screen.findByRole("textbox", { name: /Reply to chat/ }),
    {
      target: { value: "Session-only follow-up" },
    },
  );
  for (const route of ["settings", "persona", "sources", "workspace"]) {
    await navigate(route);
    expect(screen.getByRole("textbox", { name: /Ask anything/ })).toBe(ask);
    expect((ask as HTMLInputElement).value).toBe("Global unsent question");
    expect(screen.getAllByRole("form", { name: "New chat" })).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("main"));
  }
  expect(
    (
      screen.getByRole("textbox", {
        name: /Reply to chat/,
      }) as HTMLInputElement
    ).value,
  ).toBe("Session-only follow-up");
});
