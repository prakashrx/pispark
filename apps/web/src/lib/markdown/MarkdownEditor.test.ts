import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, expect, test } from "vitest";
import MarkdownEditor from "./MarkdownEditor.svelte";

afterEach(cleanup);

const text = "---\ndescription: Notes\n---\n# Title\r\n\r\nFirst part.\r\n";

test("Preview reads; Edit is the whole text as written, and typing keeps the file's line endings", async () => {
  const changes: string[] = [];
  render(MarkdownEditor, { value: text, label: "Notes", frontmatter: "hidden", onchange: (value: string) => changes.push(value) });
  const preview = screen.getByRole("group", { name: "Notes" });
  expect(preview.querySelector("h1")?.textContent).toBe("Title");
  expect(preview.textContent).not.toContain("description: Notes");
  expect(screen.queryByRole("textbox")).toBeNull();

  await fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
  const field = screen.getByRole("textbox", { name: "Notes, Markdown" }) as HTMLTextAreaElement;
  expect(field.value).toBe("---\ndescription: Notes\n---\n# Title\n\nFirst part.\n");
  await fireEvent.input(field, { target: { value: field.value.replace("First part.", "First part.\nSecond line.") } });
  expect(changes).toEqual([text.replace("First part.\r\n", "First part.\r\nSecond line.\r\n")]);

  await fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
  expect(screen.getByRole("group", { name: "Notes" }).textContent).toContain("Second line.");
});

test("an empty text says where to start, and Write it opens the editor", async () => {
  render(MarkdownEditor, { value: "", label: "Skill", placeholder: "Ask Agent Builder, or write it yourself." });
  expect(screen.getByText("Ask Agent Builder, or write it yourself.")).toBeTruthy();
  await fireEvent.click(screen.getByRole("button", { name: "Write it" }));
  await tick();
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Skill, Markdown" }));
});

test("read-only is the preview alone", () => {
  render(MarkdownEditor, { value: "Same.\n\nNew.\n", label: "Doc", editable: false });
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByRole("group", { name: "Doc" }).textContent).toContain("New.");
});
