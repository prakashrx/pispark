import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { RuntimeError } from "../src/core/runtime/errors.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";

const code = (expected: string) => (error: unknown) => error instanceof RuntimeError && error.code === expected;

async function fixture() {
  const h = await testHome("pispark-archive-");
  h.provider.automatic = true;
  const runtime = new SessionRuntime(h.configuration);
  const folder = await h.folder("work", { "keep.txt": "THE PROJECT'S OWN FILE" });
  return {
    ...h,
    runtime,
    folder,
    cleanup: async () => {
      await runtime.shutdown();
      await h.remove();
    },
  };
}

test("archive puts a session away and restore brings it back; a busy session is not archived", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(chat.id, "hello").completion;
    const other = await f.runtime.create({ folder: f.folder });

    // While it runs, it stays.
    f.provider.automatic = false;
    const run = f.runtime.start(other.id, "working");
    await eventually(() => f.provider.active === 1);
    await assert.rejects(f.runtime.archive(other.id), code("busy"));
    f.provider.requests.at(-1)!.release();
    await run.completion;
    f.provider.automatic = true;

    // Settled and loaded: it unloads and leaves the list; opening it is refused until it is restored.
    await f.runtime.archive(chat.id);
    assert.deepEqual(f.runtime.list().map((s) => s.id), [other.id]);
    assert.deepEqual(f.runtime.archived().map((s) => s.id), [chat.id]);
    assert.equal(f.runtime.archived()[0]!.status, "unloaded");
    assert.throws(() => f.runtime.session(chat.id), code("not-found"));
    await assert.rejects(f.runtime.open(chat.id), code("not-found"));
    await assert.rejects(f.runtime.ensure(chat.id), code("not-found"));

    f.runtime.restore(chat.id);
    assert.deepEqual(f.runtime.archived(), []);
    assert.equal(f.runtime.list().length, 2);
    // Its history is all there.
    await f.runtime.open(chat.id);
    assert.ok(f.runtime.items(chat.id, {}).items.length > 0);
    // Restoring what is not archived changes nothing.
    f.runtime.restore(chat.id);
    assert.equal(f.runtime.list().length, 2);
  } finally {
    await f.cleanup();
  }
});

test("delete removes an archived session's folder, its persona layer included, and nothing else", async () => {
  const f = await fixture();
  try {
    await f.persona("app", { name: "App", home: "desk" });
    const chat = await f.runtime.create({ persona: "app" });
    await f.runtime.start(chat.id, "hello").completion;
    f.runtime.personas.save({ chat: chat.id }, "", { base: ["app"], off: ["tool:read"] });
    const dir = join(f.home, "chats", chat.id);
    assert.ok(existsSync(join(dir, "persona", "persona.json")));

    // Only an archived session is deleted.
    assert.throws(() => f.runtime.delete(chat.id), code("busy"));
    await f.runtime.archive(chat.id);
    f.runtime.delete(chat.id);
    assert.equal(existsSync(dir), false);
    assert.deepEqual(f.runtime.archived(), []);
    assert.deepEqual(f.runtime.list(), []);
    assert.throws(() => f.runtime.restore(chat.id), code("not-found"));
    // The app's own folder and the project's files are not the session's to remove.
    assert.ok(existsSync(join(f.home, "apps", "app")));
    assert.ok(existsSync(join(f.folder, "keep.txt")));
  } finally {
    await f.cleanup();
  }
});

test("an app's own folder is not offered among Ask's recent folders", async () => {
  const f = await fixture();
  try {
    await f.persona("app", { name: "App", home: "desk" });
    await f.runtime.create({ persona: "app" });
    await f.runtime.create({ folder: f.folder });
    const recent = f.runtime.recentFolders();
    assert.equal(recent.length, 1);
    assert.ok(!recent.some((folder) => folder.includes(join("apps", "app"))));
  } finally {
    await f.cleanup();
  }
});
