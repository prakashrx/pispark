import { expect, test } from "vitest";
import { parsePatch } from "./diff";

const PATCH = [
  "--- demo.ts",
  "+++ demo.ts",
  "@@ -1,4 +1,3 @@",
  " export function total(items: number[]) {",
  "-  let sum = 0;",
  "-  return sum;",
  "+  return items.reduce((sum, item) => sum + item, 0);",
  " }",
  "@@ -10,2 +9,3 @@",
  " a",
  "+b",
  " c",
  "\\ No newline at end of file",
  "",
].join("\n");

test("a unified patch becomes hunks of numbered lines with counts", () => {
  const diff = parsePatch(PATCH);
  expect(diff.path).toBe("demo.ts");
  expect([diff.added, diff.removed, diff.hunks.length]).toEqual([2, 2, 2]);
  expect(diff.hunks[0]!.rows.map((r) => [r.kind, r.old, r.new])).toEqual([
    ["context", 1, 1],
    ["del", 2, undefined],
    ["del", 3, undefined],
    ["add", undefined, 2],
    ["context", 4, 3],
  ]);
  expect(diff.hunks[1]!.rows.map((r) => [r.kind, r.old, r.new, r.text])).toEqual([
    ["context", 10, 9, "a"],
    ["add", undefined, 10, "b"],
    ["context", 11, 11, "c"],
  ]);
});

test("odd input never throws: no hunks, a created file, git-style paths", () => {
  expect(parsePatch("")).toEqual({ hunks: [], added: 0, removed: 0 });
  expect(parsePatch("not a patch at all").hunks).toEqual([]);
  expect(parsePatch("--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+hello\n").path).toBe("src/new.ts");
});
