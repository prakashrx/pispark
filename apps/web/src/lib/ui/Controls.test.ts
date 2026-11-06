import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ControlsFixture from "./ControlsFixture.svelte";
import MultiSelect from "./MultiSelect.svelte";
import Selector from "./Selector.svelte";
import Input from "./Input.svelte";
import Button from "./Button.svelte";
import buttonSource from "./Button.svelte?raw";
import inputSource from "./Input.svelte?raw";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("fields own default appearance, linked help/error, bindings, read-only and native events", async () => {
  render(ControlsFixture);
  const input = screen.getByRole("textbox", { name: "Name" });
  expect(input.classList.contains("ui-input")).toBe(true);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.hasAttribute("required")).toBe(true);
  const descriptions = input
    .getAttribute("aria-describedby")!
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
  expect(descriptions).toContain("Visible help");
  expect(descriptions).toContain("Required name");
  await fireEvent.input(input, { target: { value: "Draft" } });
  expect(screen.getByLabelText("Draft name").textContent).toBe("Draft");
  expect(
    screen
      .getByRole("textbox", { name: "Description" })
      .hasAttribute("readonly"),
  ).toBe(true);
  await fireEvent.click(screen.getByRole("checkbox", { name: "Include" }));
  expect(screen.getByLabelText("Included").textContent).toBe("true");
  await fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
  expect(screen.getByLabelText("Switched").textContent).toBe("true");
  // Components, not feature class strings, own the actual default geometry/focus styles.
  expect(inputSource).toContain("border: 1px solid");
  expect(inputSource).toContain("outline: 2px solid");
  expect(buttonSource).toContain('data-variant="primary"');
  expect(buttonSource).toContain("border-radius");
});

test("buttons use finite variants/sizes, busy safety and accessible unavailable behavior", async () => {
  const onclick = vi.fn();
  const view = render(Button, {
    variant: "destructive",
    size: "icon",
    loading: true,
    "aria-label": "Remove",
    onclick,
  });
  const button = screen.getByRole("button", {
    name: "Remove",
  }) as HTMLButtonElement;
  expect(button.classList.contains("ui-button")).toBe(true);
  expect(button.dataset.variant).toBe("destructive");
  expect(button.dataset.size).toBe("icon");
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  await fireEvent.click(button);
  expect(onclick).not.toHaveBeenCalled();
  await view.rerender({ loading: false, unavailable: "Not supported" });
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  await fireEvent.click(button);
  expect(onclick).not.toHaveBeenCalled();
  const change = vi.fn();
  render(Input, { label: "Native event", oninput: change, disabled: true });
  expect(
    (screen.getByRole("textbox", { name: "Native event" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
});

test("tabs rove past disabled choices, link panels and retain input drafts", async () => {
  render(ControlsFixture);
  const first = screen.getByRole("tab", { name: "First" });
  const draft = screen.getByRole("textbox", { name: "Retained draft" });
  await fireEvent.input(draft, { target: { value: "Still here" } });
  first.focus();
  await fireEvent.keyDown(first, { key: "ArrowRight" });
  const last = screen.getByRole("tab", { name: "Last" });
  expect(document.activeElement).toBe(last);
  expect(last.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").id).toBe(
    last.getAttribute("aria-controls"),
  );
  await fireEvent.keyDown(last, { key: "Home" });
  expect(
    (
      screen.getByRole("textbox", {
        name: "Retained draft",
      }) as HTMLInputElement
    ).value,
  ).toBe("Still here");
  await fireEvent.keyDown(first, { key: "End" });
  expect(document.activeElement).toBe(last);
});

test("menu owns roving focus, disabled items, dismissal and trigger focus return", async () => {
  render(ControlsFixture);
  const trigger = screen.getByRole("button", { name: "Actions" });
  await fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const first = await screen.findByRole("menuitem", { name: "First action" });
  expect(document.activeElement).toBe(first);
  await fireEvent.keyDown(first, { key: "ArrowDown" });
  const last = screen.getByRole("menuitem", { name: "Last action" });
  expect(document.activeElement).toBe(last);
  await fireEvent.click(last);
  expect(screen.getByLabelText("Action").textContent).toBe("two");
  expect(document.activeElement).toBe(trigger);
  await fireEvent.click(trigger);
  await fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await fireEvent.click(trigger);
  await fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

test("dialog owns initial focus, visible title/help, Tab containment, Escape and focus return", async () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  render(ControlsFixture);
  const trigger = screen.getByRole("button", { name: "Open dialog" });
  trigger.focus();
  await fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Test dialog" });
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Dialog name" }),
  );
  const last = screen.getByRole("button", { name: "Done" });
  last.focus();
  await fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Close dialog" }),
  );
  await fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("busy dialog ignores cancel and groups/disclosures keep native semantics", async () => {
  render(ControlsFixture, { busy: true });
  await fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
  const dialog = await screen.findByRole("dialog");
  await fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(
    (screen.getByRole("button", { name: "Close dialog" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByRole("group", { name: "Resources" })).toBeTruthy();
  expect(screen.getByText("Details").tagName).toBe("SUMMARY");
});

test("selector field default states, unknown value, loading, disabled and typeahead", async () => {
  const view = render(Selector, {
    label: "Choice",
    display: "field",
    options: [
      { value: "a", label: "Apple" },
      { value: "b", label: "Banana" },
    ],
    value: "gone",
    error: "Unavailable choices",
  });
  const trigger = screen.getByRole("button", {
    name: "Choice: Unavailable: gone",
  });
  expect(trigger.dataset.display).toBe("field");
  expect(trigger.getAttribute("aria-invalid")).toBe("true");
  await fireEvent.click(trigger);
  const list = await screen.findByRole("listbox");
  await fireEvent.keyDown(list, { key: "b" });
  await fireEvent.keyDown(list, { key: "Enter" });
  expect(screen.getByRole("button", { name: "Choice: Banana" })).toBeTruthy();
  await view.rerender({ loading: true });
  expect((trigger as HTMLButtonElement).disabled).toBe(true);
  expect(trigger.getAttribute("aria-busy")).toBe("true");
  await view.rerender({ loading: false, readonly: true });
  await fireEvent.click(trigger);
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("MultiSelect preserves unknown values, searches real labels, removes by keyboard and validates custom references", async () => {
  render(MultiSelect, {
    label: "References",
    value: ["unknown"],
    options: [{ value: "known", label: "Readable name" }],
    allowCustom: true,
    validateCustom: (value: string) =>
      /^[a-z-]+$/.test(value) ? undefined : "Use a reference name",
  });
  expect(screen.getByText("(Unavailable)")).toBeTruthy();
  await fireEvent.click(
    screen.getByRole("button", { name: "Add References: Choose an option" }),
  );
  const search = await screen.findByRole("combobox");
  await fireEvent.input(search, { target: { value: "Readable" } });
  await fireEvent.keyDown(search, { key: "Enter" });
  expect(
    screen.getByRole("button", { name: "Remove Readable name" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Remove unknown" })).toBeTruthy();
  const custom = screen.getByRole("textbox", { name: "Custom References" });
  await fireEvent.input(custom, { target: { value: "Bad ref" } });
  await fireEvent.keyDown(custom, { key: "Enter" });
  expect(screen.getByRole("alert").textContent).toBe("Use a reference name");
  await fireEvent.input(custom, { target: { value: "repair" } });
  await fireEvent.keyDown(custom, { key: "Enter" });
  const chip = screen.getByRole("button", { name: "Remove repair" });
  await fireEvent.keyDown(chip, { key: "Delete" });
  expect(screen.queryByRole("button", { name: "Remove repair" })).toBeNull();
  expect(screen.getByRole("button", { name: "Remove unknown" })).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Remove Readable name" }),
  );
});

test("dialog wraps native summary and opened read-only content while excluding ineligible targets", async () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      const closedContent =
        this.tagName === "TEXTAREA" && !this.closest("details")?.open;
      return {
        length: closedContent || this.style.display === "none" ? 0 : 1,
      } as DOMRectList;
    },
  );
  render(ControlsFixture, { focusCases: true });
  const trigger = screen.getByRole("button", { name: "Open dialog" });
  trigger.focus();
  await fireEvent.click(trigger);
  const close = screen.getByRole("button", { name: "Close dialog" });
  const summary = screen.getByText("Dialog details");
  close.focus();
  await fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(summary);
  await fireEvent.keyDown(summary, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  summary.closest("details")!.open = true;
  const readonly = screen.getByRole("textbox", { name: "Read-only detail" });
  close.focus();
  await fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(readonly);
  await fireEvent.keyDown(readonly, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  await fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(document.activeElement).toBe(trigger);
});
