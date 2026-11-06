import { render, screen, fireEvent, cleanup } from "@testing-library/svelte";
import { test, expect, vi, afterEach } from "vitest";
import Radio from "./Radio.svelte";
import radioSource from "./Radio.svelte?raw";
afterEach(cleanup);
test("radio owns native semantics, linked label/help, default focus appearance and unavailable state", () => {
  render(Radio, {
    label: "Local model",
    help: "Configured model",
    name: "models",
    value: "local",
    checked: true,
  });
  const radio = screen.getByRole("radio", {
    name: "Local model",
  }) as HTMLInputElement;
  expect(radio.checked).toBe(true);
  expect(radio.name).toBe("models");
  expect(radio.value).toBe("local");
  expect(
    document.getElementById(radio.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe("Configured model");
  expect(radioSource).toContain("input:focus-visible");
  expect(radioSource).toContain("input:disabled");
});
test("disabled radio cannot call persistence; current value change forwards the native event", async () => {
  const onchange = vi.fn();
  const rendered = render(Radio, {
    label: "Unavailable",
    name: "models",
    disabled: true,
    onchange,
  });
  const input = screen.getByRole("radio") as HTMLInputElement;
  expect(input.disabled).toBe(true);
  input.click();
  expect(onchange).not.toHaveBeenCalled();
  await rendered.rerender({
    label: "Available",
    name: "models",
    disabled: false,
    onchange,
  });
  await fireEvent.click(input);
  expect(onchange).toHaveBeenCalledOnce();
});
