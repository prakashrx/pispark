import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { isInside, writeAtomic } from "../src/core/files.js";

test("a path is inside a folder unless it climbs out, even when a name starts with two dots", () => {
  const root = resolve("/tmp/pispark-root");
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, resolve(root, "..foo")), true);
  assert.equal(isInside(root, resolve(root, "child/file")), true);
  assert.equal(isInside(root, resolve(root, "..")), false);
  assert.equal(isInside(root, resolve(root, "../x")), false);
  assert.equal(isInside(root, `${root}-other`), false);
});

test("a save refused while Windows holds the file is tried again; elsewhere, and for any other reason, it fails at once", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "pispark-files-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "session.json");
  writeFileSync(file, "old");
  /** A file system that refuses the first `refusals` replacements with `code`. */
  const held = (refusals: number, code: string) => {
    const system = {
      tries: 0,
      rename: (from: string, to: string) => {
        if (system.tries++ < refusals) throw Object.assign(new Error(code), { code });
        renameSync(from, to);
      },
    };
    return system;
  };
  const read = () => readFileSync(file, "utf8");

  const scanner = held(2, "EPERM");
  writeAtomic(file, "new", { rename: scanner.rename, platform: "win32" });
  assert.deepEqual([read(), scanner.tries], ["new", 3]);

  // Held for longer than the save waits: it fails, the old file stays, and nothing is left beside it.
  const stuck = held(Infinity, "EBUSY");
  assert.throws(() => writeAtomic(file, "never", { rename: stuck.rename, platform: "win32" }), { code: "EBUSY" });
  assert.equal(read(), "new");
  assert.deepEqual(readdirSync(folder), ["session.json"]);

  for (const [code, platform] of [["ENOSPC", "win32"], ["EPERM", "linux"]] as const) {
    const once = held(1, code);
    assert.throws(() => writeAtomic(file, "never", { rename: once.rename, platform }), { code });
    assert.equal(once.tries, 1, code);
  }
});
