import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sessionTitle, validSessionTitle } from "../src/contract/session-title.js";
import { SessionStorage, type SessionMetadata } from "../src/core/runtime/storage.js";

test("session titles take only the first nonempty line, normalize controls and bound Unicode code points", () => {
  assert.equal(sessionTitle("\n \t\n Fix\t the\u202E issue\u200B now\nprivate second line"), "Fix the issue now");
  assert.equal(sessionTitle("😀".repeat(80)), "😀".repeat(80));
  assert.equal(sessionTitle("😀".repeat(81)), "😀".repeat(79) + "…");
  assert.equal(sessionTitle("<script>alert(1)</script>"), "<script>alert(1)</script>");
  for (const value of [null, 42, "", "x\nsecond", " x ", "x\u202Ey", "a".repeat(81)]) assert.equal(validSessionTitle(value), false);
  assert.equal(validSessionTitle("A useful title"), true);
});

test("session.json accepts an optional title and rejects malformed titles without reading the transcript", async () => {
  const root = await mkdtemp(join(tmpdir(), "pispark-titles-"));
  try {
    const storage = new SessionStorage(root);
    const id = "10000000-0000-4000-8000-000000000001";
    const metadata: SessionMetadata = {
      version: 2,
      id,
      cwd: root,
      agent: "default",
      createdAt: "2026-01-01T12:00:00Z",
      active: false,
      interrupted: false,
    };
    storage.write(metadata);
    assert.equal(storage.read(id).title, undefined);
    assert.equal(storage.list()[0]!.title, undefined);
    assert.equal(storage.hasHistory(id), false);
    storage.write({ ...metadata, title: "First message" });
    assert.equal(storage.read(id).title, "First message");
    const { id: _id, ...stored } = metadata;
    for (const title of ["", 42, "a".repeat(81), "invisible\u202Etitle", "two\nlines"]) {
      await writeFile(join(root, id, "session.json"), JSON.stringify({ ...stored, title }));
      assert.throws(() => storage.read(id), { code: "storage" });
    }
    await writeFile(join(root, id, "session.json"), JSON.stringify({ ...stored, agent: "../escape" }));
    assert.throws(() => storage.read(id), { code: "storage" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
