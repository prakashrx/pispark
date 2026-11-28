import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notesVersion, releaseNotes } from "../src/core/release-notes.js";

const version = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;

test("the version being built has its release notes: a release says what is new (docs/releasing.md)", () => {
  const found = releaseNotes();
  assert.ok(found, `docs/releases/${version}.md is missing or empty: write what is new in ${version}`);
  assert.equal(found.version, version);
  assert.match(found.notes, new RegExp(`^# PiSpark ${version.replaceAll(".", "\\.")}\\n`));
});

test("a build of main shares its version's notes; a version without notes has none", () => {
  assert.equal(notesVersion("0.7.0-main.52"), "0.7.0");
  assert.equal(notesVersion("0.7.0"), "0.7.0");
  assert.equal(notesVersion("development"), undefined);
  const root = mkdtempSync(join(tmpdir(), "pispark-notes-"));
  try {
    mkdirSync(join(root, "docs", "releases"), { recursive: true });
    writeFileSync(join(root, "docs", "releases", "1.2.3.md"), "# PiSpark 1.2.3\n\nSomething new.\n");
    writeFileSync(join(root, "docs", "releases", "1.2.4.md"), "\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    const notes = { version: "1.2.3", notes: "# PiSpark 1.2.3\n\nSomething new." };
    assert.deepEqual(releaseNotes("1.2.3-main.7", root), notes);
    assert.deepEqual(releaseNotes("1.2.3", root), notes);
    // Started from its source: the checkout's own version.
    assert.deepEqual(releaseNotes(undefined, root), notes);
    // No file, an empty one, or something that is not a version: nothing to show.
    assert.equal(releaseNotes("9.9.9", root), undefined);
    assert.equal(releaseNotes("1.2.4", root), undefined);
    assert.equal(releaseNotes("../../1.2.3", root), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
