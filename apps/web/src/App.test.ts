import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import { afterEach, expect, test, vi } from "vitest";
import App from "./App.svelte";

function mockHealth(
  status = 200,
  body: unknown = { status: "ok", service: "pispark" },
) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("renders the starter, checks the backend, and toggles the sidebar", async () => {
  const fetchMock = mockHealth();
  render(App);
  expect(
    screen.getByRole("heading", { name: "Start with a spark." }),
  ).toBeTruthy();
  await screen.findByText("Backend online");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/health",
    expect.objectContaining({ cache: "no-store" }),
  );
  const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
  expect(collapse.getAttribute("aria-expanded")).toBe("true");
  await fireEvent.click(collapse);
  expect(screen.queryByRole("complementary")).toBeNull();
  const expand = screen.getByRole("button", { name: "Expand sidebar" });
  expect(expand.getAttribute("aria-expanded")).toBe("false");
  await fireEvent.click(expand);
  expect(
    screen.getByRole("complementary", { name: "Workspace sidebar" }),
  ).toBeTruthy();
});

test("composer is explicitly local-only demo and never calls an agent endpoint", async () => {
  const fetchMock = mockHealth();
  render(App);
  await screen.findByText("Backend online");
  const button = screen.getByRole("button", {
    name: "Preview demo",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(
    (
      screen.getByRole("combobox", {
        name: "Persona (not connected)",
      }) as HTMLSelectElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("combobox", {
        name: "Model (not connected)",
      }) as HTMLSelectElement
    ).disabled,
  ).toBe(true);
  await fireEvent.input(screen.getByRole("textbox", { name: "Ask PiSpark" }), {
    target: { value: "A local draft" },
  });
  expect(button.disabled).toBe(false);
  await fireEvent.submit(screen.getByRole("form", { name: "Demo composer" }));
  expect(screen.getByText(/Demo only — nothing was sent/)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("reports an unreachable backend and supports a real retry", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Network unavailable"));
  vi.stubGlobal("fetch", fetchMock);
  render(App);
  await screen.findByText("Backend unavailable");
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ status: "ok", service: "pispark" })),
  );
  await fireEvent.click(
    screen.getByRole("button", { name: "Refresh backend health" }),
  );
  await screen.findByText("Backend online");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test.each([
  [503, { status: "ok", service: "pispark" }],
  [200, { status: "ok", service: "other" }],
  [200, null],
])("does not claim health for invalid response %s %j", async (status, body) => {
  mockHealth(status, body);
  render(App);
  await waitFor(() =>
    expect(screen.getByText("Backend unavailable")).toBeTruthy(),
  );
});
