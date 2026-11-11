import { fireEvent, render, screen } from "@testing-library/svelte";
import { expect, test, vi } from "vitest";
import type { ExtensionDialog } from "../../../../server/src/contract/protocol";
import ExtensionQuestion from "./ExtensionQuestion.svelte";

const ask = (dialog: ExtensionDialog) => {
  const onanswer = vi.fn();
  render(ExtensionQuestion, { dialog, onanswer });
  return onanswer;
};

test("a confirmation starts on the question, answers to Y and N, and Escape skips", async () => {
  const onanswer = ask({ id: "1", kind: "confirm", title: "Run it?", message: "rm -rf build" });
  const group = screen.getByRole("group", { name: "Run it?" });
  expect(document.activeElement).toBe(group);
  expect(screen.getByRole("button", { name: "Yes" })).not.toBe(document.activeElement);
  await fireEvent.keyDown(group, { key: "n" });
  await fireEvent.keyDown(group, { key: "y" });
  await fireEvent.keyDown(group, { key: "Escape" });
  expect(onanswer.mock.calls).toEqual([[false], [true], [null]]);
  expect(screen.getByText("rm -rf build")).toBeTruthy();
});

test("a short list starts on its first option and a long one on its filter; numbers and Enter pick", async () => {
  const short = ask({ id: "1", kind: "select", title: "Reviewer", options: ["Ada — owns the parser", "Grace"] });
  expect(document.activeElement?.textContent).toContain("Ada");
  // The label leads and the rest reads as a quieter second line.
  expect(screen.getByText("owns the parser").className).toMatch(/detail/);
  await fireEvent.keyDown(document.activeElement!, { key: "2" });
  expect(short).toHaveBeenCalledWith("Grace");
});

test("a long list is filtered by typing, Enter picks the first match, and no match is said", async () => {
  const options = Array.from({ length: 12 }, (_, i) => `Option ${i + 1}`);
  const onanswer = ask({ id: "2", kind: "select", title: "Which?", options });
  const filter = screen.getByRole("searchbox", { name: "Filter options" });
  expect(document.activeElement).toBe(filter);
  await fireEvent.input(filter, { target: { value: "option 1" } });
  expect(screen.getAllByRole("button", { name: /Option 1/ }).map((b) => b.textContent!.replace(/\s+/g, " ").trim())).toEqual(["1 Option 1", "2 Option 10", "3 Option 11", "4 Option 12"]);
  await fireEvent.keyDown(filter, { key: "Enter" });
  expect(onanswer).toHaveBeenLastCalledWith("Option 1");
  await fireEvent.input(filter, { target: { value: "zzz" } });
  expect(screen.getByRole("status").textContent).toContain("Nothing matches");
  // Typing digits into the filter is typing, not a quick pick.
  await fireEvent.keyDown(filter, { key: "3" });
  expect(onanswer).toHaveBeenCalledTimes(1);
});

test("an editor starts from its prefill and Ctrl+Enter submits it", async () => {
  const onanswer = ask({ id: "3", kind: "editor", title: "Edit it", prefill: "one\ntwo" });
  const field = screen.getByRole("textbox", { name: "Edit it" }) as HTMLTextAreaElement;
  expect(field.value).toBe("one\ntwo");
  expect(document.activeElement).toBe(field);
  await fireEvent.input(field, { target: { value: "three" } });
  await fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  expect(onanswer).toHaveBeenCalledWith("three");
});
