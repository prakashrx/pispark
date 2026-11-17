import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, expect, test } from "vitest";
import IdentityMark, { nameHue } from "./IdentityMark.svelte";
import Menu from "./Menu.svelte";
import StatusMark from "./StatusMark.svelte";

afterEach(() => cleanup());

test("a status mark says its state in words, beside it or for screen readers", () => {
  const { container, rerender } = render(StatusMark, { kind: "attention", label: "Needs you" });
  const mark = container.querySelector(".status-mark")!;
  expect(mark.getAttribute("data-kind")).toBe("attention");
  expect(mark.querySelector(".sr-only")?.textContent).toBe("Needs you");
  expect(mark.querySelector('[aria-hidden="true"]')?.textContent).toBe("?");

  rerender({ kind: "busy", label: "Working", words: true, detail: "2m" });
  expect(mark.querySelector(".word")?.textContent).toBe("Working 2m");
  expect(mark.querySelector(".sr-only")).toBeNull();
});

test("an identity mark shows an initial in a hue that stays with the name", () => {
  expect(nameHue("Shop develop")).toBe(nameHue("  shop develop "));
  const hues = new Set(["Coder", "Writer", "Shop", "Notes", "Research", "Ops"].map(nameHue));
  expect(hues.size).toBeGreaterThan(2);

  const { container } = render(IdentityMark, { name: " écrire" });
  const mark = container.querySelector(".identity") as HTMLElement;
  expect(mark.textContent).toBe("É");
  expect(mark.getAttribute("aria-hidden")).toBe("true");
  expect(mark.style.getPropertyValue("--h")).toBe(String(nameHue("écrire")));
});

test("a menu's panel closes from its scrim and keeps its items and title", async () => {
  render(Menu, { label: "Session actions", items: [{ id: "a", label: "Archive", onselect: () => {} }] });
  const trigger = screen.getByRole("button", { name: "Session actions" });
  await fireEvent.click(trigger);
  const menu = screen.getByRole("menu", { name: "Session actions" });
  expect(menu.querySelector(".sheet-title")?.textContent).toBe("Session actions");
  expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();

  await fireEvent.click(document.querySelector(".sheet-scrim")!);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
