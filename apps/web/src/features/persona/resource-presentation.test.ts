import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resourceRows, personaName } from "./persona-presentation";
import ResourceList from "./ResourceList.svelte";
import type { EffectiveResource } from "../../../../server/src/persona-protocol";
const owner = { root: "managed", path: "child", id: "child" };
const origin = { root: "source", path: "base", id: "base" };
const resource: EffectiveResource = {
  id: "skill-1",
  nativeName: "Native skill",
  description: "Actual description",
  directory: "skills/base",
  origin,
  routes: [],
  replaced: [],
};
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
afterEach(cleanup);

test("presentation uses authoritative slot order and full origin identity without an inheritance merge", () => {
  const local = [
    { id: "local", file: "old.md" },
    { id: "new", text: "Local draft" },
  ];
  const resolved = [
    {
      ...resource,
      id: "local",
      file: "old.md",
      directory: undefined,
      origin: owner,
    },
    resource,
  ];
  const rows = resourceRows(local, resolved, owner);
  expect(rows[0]!.local).toBe(local[0]);
  expect(rows[1]!.resolved).toBe(resource);
  expect(rows[2]!.local).toBe(local[1]);
  local[0]!.file = "new.md";
  expect(resourceRows(local, resolved, owner)[0]!.resolved).toBeUndefined();
  expect(
    personaName(origin, [
      {
        ref: { ...origin, root: "different" },
        name: "Wrong",
        valid: true,
        writable: false,
        diagnostics: [],
      },
    ]),
  ).toBe("Unavailable persona");
});

test("ordinary skill Add skips inherited IDs; Customize is private and capacity applies to Add and Customize", async () => {
  const onchange = vi.fn();
  const view = render(ResourceList, {
    reference: owner,
    items: [],
    effective: [resource],
    onchange,
  });
  await fireEvent.click(
    screen.getByRole("button", { name: "Skill 1 actions" }),
  );
  await fireEvent.click(screen.getByRole("menuitem", { name: "Customize" }));
  expect(
    (screen.getByRole("textbox", { name: "Skill folder" }) as HTMLInputElement)
      .value,
  ).toBe("");
  await fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "child/skill" },
  });
  await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onchange).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
  await fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "child/new" },
  });
  await fireEvent.submit(document.querySelector("form")!);
  expect(onchange).toHaveBeenCalledTimes(1);
  await fireEvent.click(
    screen.getByRole("button", { name: "Skill 2 actions" }),
  );
  await fireEvent.click(
    screen.getByRole("menuitem", { name: "Advanced settings" }),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Reference name",
      }) as HTMLInputElement
    ).value,
  ).toBe("skill-2");
  await fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await view.rerender({
    items: Array.from({ length: 32 }, (_, i) => ({
      id: `local-${i}`,
      directory: `skills/${i}`,
    })),
  });
  expect(
    (screen.getByRole("button", { name: "Add skill" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await fireEvent.click(
    screen.getByRole("button", { name: "Skill 1 actions" }),
  );
  expect(
    (screen.getByRole("menuitem", { name: "Customize" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
