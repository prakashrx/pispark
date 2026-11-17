import { afterEach, expect, test, vi } from "vitest";
import { attention } from "./attention.svelte";

afterEach(() => {
  attention.dismissToast();
  attention.dismissNudge();
  vi.useRealTimers();
});

test("a toast leaves on its own, but not while it is held", () => {
  vi.useFakeTimers();
  const undo = vi.fn();
  attention.say("Archived “x”", { label: "Undo", run: undo });
  expect(attention.toast?.text).toBe("Archived “x”");
  attention.holdToast(true);
  vi.advanceTimersByTime(10_000);
  expect(attention.toast).toBeDefined();
  attention.holdToast(false);
  vi.advanceTimersByTime(6_000);
  expect(attention.toast).toBeUndefined();
});

test("a newer toast replaces the last; the nudge is apart and leaves after its own time", () => {
  vi.useFakeTimers();
  attention.say("first");
  attention.say("second");
  expect(attention.toast?.text).toBe("second");
  attention.needsYou("s1", "Fix the test");
  expect(attention.nudge).toEqual({ id: "s1", name: "Fix the test", agent: "Fix the test" });
  vi.advanceTimersByTime(6_000);
  expect(attention.toast).toBeUndefined();
  expect(attention.nudge).toBeDefined();
  vi.advanceTimersByTime(2_000);
  expect(attention.nudge).toBeUndefined();
});
