import { expect, test } from "vitest";
import { OUTPUT_READ, nextRead, shownAfter } from "./process-presentation";

test("the output view follows on from where it was while it keeps up", () => {
  expect(nextRead(1000, undefined)).toEqual({ since: 0, fresh: false });
  expect(nextRead(2 * OUTPUT_READ, { text: "", next: 0 })).toEqual({ since: 0, fresh: false });
  const shown = shownAfter({ text: "a\n", next: 2 }, { text: "b\n", next: 4 }, false);
  expect(shown).toEqual({ text: "a\nb\n", next: 4, cut: undefined });
});

test("far behind (a large log opened, or output faster than a read a second), it starts again near the end and says older output is not shown", () => {
  const written = 6 * 1024 * 1024;
  expect(nextRead(written, undefined)).toEqual({ since: written - OUTPUT_READ, fresh: true });
  expect(nextRead(written, { text: "old", next: written - 3 * OUTPUT_READ })).toEqual({ since: written - OUTPUT_READ, fresh: true });
  expect(shownAfter({ text: "old", next: 3 }, { text: "new", next: written }, true)).toEqual({ text: "new", next: written, cut: true });
});

test("the view never holds more than it keeps", () => {
  const shown = shownAfter({ text: "x".repeat(150), next: 150 }, { text: "y".repeat(100), next: 250 }, false, 200);
  expect(shown.text).toBe("x".repeat(100) + "y".repeat(100));
  expect(shown.cut).toBe(true);
});
