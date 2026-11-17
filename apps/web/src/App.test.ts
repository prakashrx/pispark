import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import App from "./App.svelte";
import { layout } from "./shell/layout.svelte";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/api/catalog"
              ? { home: "/home/me", recentFolders: [] }
              : url.startsWith("/api/agents")
                ? { agents: [] }
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
  layout.sidebarHidden = false;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function navigate(page: string) {
  window.location.hash = `/${page}`;
  await fireEvent(window, new Event("hashchange"));
}

/** Types into a composer the way a person would: its text changes and it hears an input event. */
async function type(field: HTMLElement, text: string) {
  field.textContent = text;
  await fireEvent.input(field);
}

test("renders truthful unconfigured state and never submits a draft without configuration", async () => {
  render(App);
  expect(screen.getByRole("heading", { name: "New session", level: 1 })).toBeTruthy();
  expect(screen.getByRole("main").getAttribute("aria-label")).toBe("New session");
  expect(screen.getByRole("button", { name: "Start session" }).getAttribute("aria-disabled")).toBe("true");
  const ask = screen.getByRole("textbox", { name: "Ask anything" });
  // Once the providers have loaded, the screen and the button both say why nothing can start.
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Start session" }).getAttribute("title")).toBe("Choose a model in Providers & models."),
  );
  expect(screen.getByRole("heading", { name: "Connect a provider to start" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Set up a provider" }).getAttribute("href")).toBe("#/settings/providers");
  await type(ask, "Keep this draft local");
  await fireEvent.submit(screen.getByRole("form", { name: "New session" }));
  expect(ask.textContent).toBe("Keep this draft local");
  // With no session open there is nothing to reply to: one message box on screen.
  expect(screen.queryByRole("textbox", { name: /Reply to session/ })).toBeNull();
  expect(vi.mocked(fetch).mock.calls.every((call) => call[1]?.method !== "POST")).toBe(true);
});

test("hides and shows the sidebar; the shortcut ignores editable inputs", async () => {
  render(App);
  expect(screen.getByText("No sessions yet.")).toBeTruthy();
  await fireEvent.keyDown(screen.getByRole("textbox", { name: /Ask anything/ }), { key: "b", ctrlKey: true });
  expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
  expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
  await fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
  expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
  await fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
  expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
});

test("settings show only real sections, each with its own address", async () => {
  render(App);
  await navigate("settings");
  expect(screen.getByRole("heading", { name: "Theme" })).toBeTruthy();
  const sections = screen.getByRole("navigation", { name: "Settings sections" });
  expect([...sections.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Appearance", "#/settings/appearance"],
    ["Providers & models", "#/settings/providers"],
    ["Remote access", "#/settings/remote"],
    ["About", "#/settings/about"],
  ]);
  expect(screen.queryByText(/Sources|Channels|Keybindings/)).toBeNull();
  await navigate("settings/providers");
  expect(screen.getByRole("heading", { name: "Your providers" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Settings sections" }).querySelector('[aria-current="page"]')?.textContent).toBe(
    "Providers & models",
  );
  await navigate("agents");
  expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Agents" }).getAttribute("aria-current")).toBe("page");
});

test("Appearance applies real browser-local themes without fictional preferences, saves or environment", async () => {
  window.location.hash = "/settings";
  render(App);
  const themes = screen.getByRole("radiogroup", { name: "Theme" });
  expect([...themes.querySelectorAll("input")].map((input) => input.value)).toEqual([
    "system",
    "daylight",
    "paper",
    "mist",
    "midnight",
    "ocean",
    "ember",
  ]);
  await fireEvent.click(themes.querySelector<HTMLInputElement>('input[value="midnight"]')!);
  expect(document.documentElement.dataset.theme).toBe("midnight");
  expect(JSON.parse(localStorage.getItem("pispark.appearance")!).theme).toBe("midnight");
  await fireEvent.input(screen.getByRole("slider", { name: "Text size" }), { target: { value: "2" } });
  expect(document.documentElement.style.fontSize).toBe("17px");
  localStorage.removeItem("pispark.appearance");
  expect(screen.getAllByRole("link", { name: "Providers & models" }).at(-1)!.getAttribute("href")).toBe("#/settings/providers");
  expect(screen.queryByRole("combobox", { name: "Workspace font family" })).toBeNull();
  for (const name of ["Save changes", "Reset to defaults"]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByText(/Git Repository|Detected runtime|Developer|Architect/)).toBeNull();
});

test("agent empty state is real and offers creation without fixture capabilities", async () => {
  window.location.hash = "/agents";
  render(App);
  expect(await screen.findByText(/Every agent builds on Default/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "New agent" })).toBeTruthy();
  expect(screen.queryByText("v1.4.2")).toBeNull();
  expect(screen.queryByText("Active in session")).toBeNull();
});

test("the new session's draft and a session's reply draft each survive going elsewhere", async () => {
  const base = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    url === "/api/sessions"
      ? new Response(
          JSON.stringify({
            sessions: [
              {
                id: "open-session",
                title: "Open session",
                createdAt: "2026-01-02T03:04:00Z",
                folder: "/home/me/project",
                agent: { id: "default", name: "Default", layered: false },
                status: "idle",
                interrupted: false,
              },
            ],
            truncated: false,
          }),
        )
      : String(url).startsWith("/api/sessions/open-session/items")
        ? new Response(JSON.stringify({ items: [], head: null, more: false }))
        : url === "/api/sessions/open-session/live"
          ? new Promise<Response>(() => {})
          : base(url, init),
  );
  render(App);
  await type(screen.getByRole("textbox", { name: /Ask anything/ }), "Unsent question");
  await navigate("s/open-session");
  await type(await screen.findByRole("textbox", { name: /Reply to session/ }), "Session-only follow-up");
  // One message box on screen at a time.
  expect(screen.queryByRole("textbox", { name: /Ask anything/ })).toBeNull();
  expect((await screen.findByRole("link", { name: "Open session" })).getAttribute("aria-current")).toBe("page");
  for (const route of ["settings", "agents", "background", "new"]) {
    await navigate(route);
    expect(document.activeElement).toBe(screen.getByRole("main"));
  }
  expect(screen.getByRole("textbox", { name: /Ask anything/ }).textContent).toBe("Unsent question");
  await navigate("s/open-session");
  expect((await screen.findByRole("textbox", { name: /Reply to session/ })).textContent).toBe("Session-only follow-up");
});
