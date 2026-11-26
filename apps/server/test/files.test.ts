import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { isInside } from "../src/core/files.js";

test("a path is inside a folder unless it climbs out, even when a name starts with two dots", () => {
  const root = resolve("/tmp/pispark-root");
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, resolve(root, "..foo")), true);
  assert.equal(isInside(root, resolve(root, "child/file")), true);
  assert.equal(isInside(root, resolve(root, "..")), false);
  assert.equal(isInside(root, resolve(root, "../x")), false);
  assert.equal(isInside(root, `${root}-other`), false);
});
