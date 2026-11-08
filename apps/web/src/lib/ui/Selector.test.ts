import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, test } from "vitest";
import Selector from "./Selector.svelte";

afterEach(cleanup);
const options = [
  { value: "one", label: "First" },
  { value: "two", label: "Second" },
];

test("supports keyboard selection and Escape with focus return", async () => {
  render(Selector, { label: "Example", value: "one", options });
  const trigger = screen.getByRole("button", { name: "Example: First" });
  await fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const list = await screen.findByRole("listbox");
  await fireEvent.keyDown(list, { key: "ArrowDown" });
  await fireEvent.keyDown(list, { key: "Enter" });
  expect(screen.getByRole("button", { name: "Example: Second" })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  await fireEvent.click(trigger);
  await fireEvent.keyDown(await screen.findByRole("listbox"), {
    key: "Escape",
  });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("filters searchable values, exposes empty state and dismisses outside", async () => {
  render(Selector, {
    label: "Folder",
    value: "one",
    options,
    searchable: true,
  });
  await fireEvent.click(screen.getByRole("button", { name: "Folder: First" }));
  const input = await screen.findByRole("combobox", { name: "Search Folder" });
  await fireEvent.input(input, { target: { value: "missing" } });
  expect(screen.getByRole("status").textContent).toContain(
    "No matches",
  );
  await fireEvent.input(input, { target: { value: "Second" } });
  await fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("button", { name: "Folder: Second" })).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: "Folder: Second" }));
  await fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
});
