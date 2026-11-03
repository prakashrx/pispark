import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chatTitle, validChatTitle } from "../src/runtime/chat-title.js";
import {
  SessionStorage,
  type SessionMetadata,
} from "../src/runtime/storage.js";

test("chat titles take only the first nonempty line, normalize controls and bound Unicode code points", () => {
  assert.equal(
    chatTitle("\n \t\n Fix\t the\u202E issue\u200B now\nprivate second line"),
    "Fix the issue now",
  );
  assert.equal(chatTitle("😀".repeat(80)), "😀".repeat(80));
  assert.equal(chatTitle("😀".repeat(81)), "😀".repeat(79) + "…");
  assert.equal(
    chatTitle("<script>alert(1)</script>"),
    "<script>alert(1)</script>",
  );
  for (const value of [
    null,
    42,
    "",
    "x\nsecond",
    " x ",
    "x\u202Ey",
    "a".repeat(81),
  ])
    assert.equal(validChatTitle(value), false);
  assert.equal(validChatTitle("A useful title"), true);
});

test("v1 storage accepts legacy optional titles and rejects malformed persisted title without reading native history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pispark-titles-"));
  try {
    const storage = new SessionStorage(root);
    const id = "10000000-0000-4000-8000-000000000001";
    storage.prepare(id);
    const metadata: SessionMetadata = {
      version: 1,
      id,
      workspace: "local",
      configuration: "test",
      cwd: root,
      createdAt: "2026-01-01T12:00:00Z",
      nativeFile: `2026_${id}.jsonl`,
      active: false,
      hasHistory: true,
      interrupted: false,
    };
    storage.write(metadata);
    assert.equal(storage.read(id).title, undefined);
    assert.equal(storage.list()[0]!.title, undefined);
    storage.write({ ...metadata, title: "First message" });
    assert.equal(storage.read(id).title, "First message");
    for (const title of [
      "",
      42,
      "a".repeat(81),
      "invisible\u202Etitle",
      "two\nlines",
    ]) {
      await writeFile(
        join(root, id, "host.json"),
        JSON.stringify({ ...metadata, title }),
      );
      assert.throws(() => storage.read(id), { code: "storage" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
