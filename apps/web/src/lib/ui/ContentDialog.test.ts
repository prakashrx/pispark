import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ContentDialog from "./ContentDialog.svelte";
import ControlsFixture from "./ControlsFixture.svelte";
import sectionSource from "./Section.svelte?raw";

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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const button = (name: string) => screen.getByRole("button", { name });
function setup(props = {}) {
  const onapply = vi.fn(() => true),
    onclose = vi.fn();
  const view = render(ContentDialog, {
    ownerKey: "a",
    value: "Original\n  <b>literal</b>",
    maxBytes: 65536,
    permission: "edit",
    onapply,
    onclose,
    ...props,
  });
  return { ...view, onapply, onclose };
}
function fakeFile(text = "Imported\ntext") {
  const bytes = new TextEncoder().encode(text);
  return {
    name: "note.md",
    type: "",
    size: bytes.byteLength,
    arrayBuffer: vi.fn(async () => bytes.buffer),
  } as unknown as File;
}
async function drop(files: File[]) {
  await fireEvent.drop(screen.getByRole("group", { name: "Text editor" }), {
    dataTransfer: { files },
  });
}

test("Section defaults retain direct children/class; split is opt-in 1:4 and stacks narrowly", () => {
  const { container } = render(ControlsFixture, { contentCases: true });
  expect(
    container
      .querySelector("section.existing-class")
      ?.getAttribute("data-layout"),
  ).toBe("stacked");
  expect(
    container.querySelector("section.existing-class > p")?.textContent,
  ).toBe("Existing content");
  expect(
    container.querySelector(
      "section.fixture-section > .section-content button",
    ),
  ).toBeTruthy();
  expect(sectionSource).toContain("minmax(0, 1fr) minmax(0, 4fr)");
  expect(sectionSource).toContain("max-width: 640px");
});
test("read uses literal non-form text, edit is private, cancel restores scroll and apply returns read in same panel", async () => {
  const { onapply } = setup();
  const dialog = screen.getByRole("region");
  const doc = screen.getByRole("document");
  expect(doc.textContent).toBe("Original\n  <b>literal</b>");
  expect(doc.querySelector("b")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  const viewport = doc.parentElement!;
  viewport.scrollTop = 123;
  await fireEvent.click(button("Edit"));
  const input = screen.getByRole("textbox", { name: "Text" });
  await waitFor(() => expect(document.activeElement).toBe(input));
  await fireEvent.input(input, {
    target: { value: "Private instructions.md" },
  });
  expect(onapply).not.toHaveBeenCalled();
  await fireEvent.click(button("Cancel"));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("document")),
  );
  expect(viewport.scrollTop).toBe(123);
  expect(screen.getByRole("document").textContent).toContain("Original");
  await fireEvent.click(button("Edit"));
  await fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "Confirmed" },
  });
  await fireEvent.click(button("Apply changes"));
  expect(onapply).toHaveBeenCalledExactlyOnceWith("Confirmed");
  expect(screen.getByRole("region")).toBe(dialog);
  expect(screen.getByRole("document").textContent).toBe("Confirmed");
});
test("add and customize only submit valid confirmed text; feature guard can reject", async () => {
  const { onapply, onclose } = setup({
    mode: "add",
    value: "",
    permission: "none",
  });
  expect((button("Add content") as HTMLButtonElement).disabled).toBe(true);
  await fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "instructions.md" },
  });
  await fireEvent.click(button("Add content"));
  expect(onapply).toHaveBeenCalledExactlyOnceWith("instructions.md");
  expect(onclose).toHaveBeenCalledOnce();
  cleanup();
  const rejected = vi.fn(() => false);
  const view = setup({ permission: "customize", onapply: rejected });
  await fireEvent.click(button("Customize"));
  await fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "Replacement" },
  });
  await fireEvent.click(button("Apply changes"));
  expect(rejected).toHaveBeenCalledExactlyOnceWith("Replacement");
  expect(screen.getByRole("textbox")).toBeTruthy();
  await view.rerender({ canApply: false });
  expect((button("Apply changes") as HTMLButtonElement).disabled).toBe(true);
});
test("dirty Escape/X asks inline; Cancel edit returns read; read-only still closes and reads", async () => {
  const { onclose } = setup();
  await fireEvent.click(button("Edit"));
  await fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "Private" },
  });
  await fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(onclose).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Discard unapplied");
  await fireEvent.click(button("Keep editing"));
  await fireEvent.click(screen.getByRole("button", { name: /^Close [A-Z]/ }));
  await fireEvent.click(button("Discard changes"));
  expect(onclose).toHaveBeenCalledOnce();
  cleanup();
  setup({ permission: "none" });
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Import text" })).toBeNull();
  expect(screen.getByRole("document")).toBeTruthy();
});
test("import/drop is local, confirms nonempty replacement, typing revokes consent, errors retain text", async () => {
  const { onapply } = setup();
  await fireEvent.click(button("Edit"));
  await drop([fakeFile()]);
  await screen.findByRole("button", { name: "Replace text" });
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain(
    "Original",
  );
  await fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "New live edit" },
  });
  expect(screen.queryByRole("button", { name: "Replace text" })).toBeNull();
  await drop([fakeFile("chosen")]);
  await fireEvent.click(
    await screen.findByRole("button", { name: "Keep current text" }),
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "New live edit",
  );
  await drop([fakeFile("chosen")]);
  await fireEvent.click(
    await screen.findByRole("button", { name: "Replace text" }),
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "chosen",
  );
  await drop([fakeFile(), fakeFile()]);
  expect(screen.getByRole("alert").textContent).toContain("one text file");
  await drop([{ ...fakeFile(), type: "image/png" } as File]);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "not a PDF or image",
    ),
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "chosen",
  );
  expect(onapply).not.toHaveBeenCalled();
});
test.each([
  "typing",
  "cancel",
  "close",
  "owner",
  "value",
  "pause",
  "readonly",
  "dispose",
  "new-import",
])("late import is revoked by %s", async (reason) => {
  const view = setup({ mode: "edit" });
  if (reason === "pause")
    await fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "Private retained" },
    });
  let finish!: (value: ArrayBuffer) => void;
  const slow = {
    ...fakeFile(),
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  } as File;
  await drop([slow]);
  if (reason === "typing")
    await fireEvent.input(screen.getByRole("textbox"), {
      target: { value: "Newer" },
    });
  if (reason === "cancel") await fireEvent.click(button("Cancel"));
  if (reason === "close") await fireEvent.click(screen.getByRole("button", { name: /^Close [A-Z]/ }));
  if (reason === "value") await view.rerender({ value: "New context" });
  if (reason === "owner")
    await view.rerender({ ownerKey: "b", value: "Other owner" });
  if (reason === "pause") await view.rerender({ active: false });
  if (reason === "readonly") await view.rerender({ permission: "none" });
  if (reason === "dispose") view.unmount();
  if (reason === "new-import") await drop([fakeFile("new import")]);
  finish(new TextEncoder().encode("STALE").buffer);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText("STALE")).toBeNull();
  if (reason !== "new-import")
    expect(screen.queryByRole("button", { name: "Replace text" })).toBeNull();
  const current = screen.queryByRole("textbox") as HTMLTextAreaElement | null;
  if (current) expect(current.value).not.toBe("STALE");
  if (reason === "pause") {
    await view.rerender({ active: true });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Private retained",
    );
  }
  if (reason === "new-import") {
    await fireEvent.click(
      await screen.findByRole("button", { name: "Replace text" }),
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "new import",
    );
  }
  expect(view.onapply).not.toHaveBeenCalled();
});
test("picker cancel and empty selection do not mutate; UTF-8 byte bound controls Apply", async () => {
  const view = setup({ mode: "add", value: "", maxBytes: 3 });
  const picker = view.container.querySelector('input[type="file"]')!;
  await fireEvent(picker, new Event("cancel"));
  await fireEvent.change(picker, { target: { files: [] } });
  expect(screen.queryByRole("alert")).toBeNull();
  await fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "éé" },
  });
  expect((button("Add content") as HTMLButtonElement).disabled).toBe(true);
  await fireEvent.change(picker, { target: { files: [fakeFile("ok")] } });
  await screen.findByRole("button", { name: "Replace text" });
  await fireEvent.click(button("Replace text"));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("ok");
});

test("optional serializable UI snapshot resumes private text after disposal without carrying import consent", async () => {
  let snapshot: import("svelte").ComponentProps<
    typeof ContentDialog
  >["retained"];
  const first = setup({
    mode: "edit",
    onstate: (state: NonNullable<typeof snapshot>) => (snapshot = state),
  });
  await fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "Retained private" },
  });
  await drop([fakeFile("pending replacement")]);
  await screen.findByRole("button", { name: "Replace text" });
  first.unmount();
  const second = setup({ mode: "edit", retained: snapshot });
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Retained private",
  );
  expect(screen.queryByRole("button", { name: "Replace text" })).toBeNull();
  await fireEvent.click(button("Cancel"));
  expect(screen.getByRole("document").textContent).toContain("Original");
  expect(second.onapply).not.toHaveBeenCalled();
});
