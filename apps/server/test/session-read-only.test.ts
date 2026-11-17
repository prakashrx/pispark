import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localProviderSettings } from "./fixtures/provider-settings.js";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";

const provider = "pispark-local-test";
const model = { provider, id: "deterministic" };
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

async function setup(t: import("node:test").TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pispark-read-only-"));
  const f = await localProviderSettings(root);
  f.control.automatic = true;
  await writeFile(f.authPath, JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }));
  await f.runtime.refresh({ allowNetwork: false });
  const home = join(root, "pispark");
  const sessions = new SessionRuntime({ home }, f.settings);
  t.after(async () => {
    await sessions.shutdown();
    await f.settings.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  /** A session with a reply in its history, then unloaded. */
  const withHistory = async (folder = root) => {
    const { id } = await sessions.create({ folder, model });
    assert.equal((await sessions.start(id, "remember this").completion).outcome, "completed");
    await sessions.stop(id);
    return id;
  };
  return { root, home, f, sessions, withHistory };
}

test("read-only: a session whose model is gone opens to be read, refuses to run, and goes on with another model", async (t) => {
  const { sessions, withHistory } = await setup(t);
  const id = await withHistory();
  const gone = await sessions.reload(id, { provider, id: "no-such-model" });
  assert.equal(gone.status, "read-only");
  assert.equal(gone.readOnly, "model");
  assert.deepEqual(gone.model, { provider, id: "no-such-model" });
  assert.deepEqual(gone.commands, []);
  const roles = sessions.items(id, {}).items.map((item) => item.role);
  assert.deepEqual(roles, ["user", "assistant"]);
  assert.equal(sessions.list().find((row) => row.id === id)?.readOnly, "model");
  assert.throws(() => sessions.start(id, "can you hear me"), code("read-only"));
  // It unloads and reopens like any session.
  await sessions.stop(id);
  assert.equal((await sessions.open(id)).readOnly, "model");
  // Choosing a model that works opens it fully, history kept.
  const back = await sessions.reload(id, model);
  assert.equal(back.status, "idle");
  assert.equal(back.readOnly, undefined);
  assert.equal((await sessions.start(id, "and now").completion).outcome, "completed");
  assert.equal(sessions.items(id, {}).items.filter((item) => item.role === "user").length, 2);
});

test("read-only: signed out, then signed in again, the next use opens it fully", async (t) => {
  const { f, sessions, withHistory } = await setup(t);
  const id = await withHistory();
  await writeFile(f.authPath, "{}");
  await f.runtime.refresh({ allowNetwork: false });
  assert.equal((await sessions.open(id)).readOnly, "model");
  await writeFile(f.authPath, JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }));
  await f.runtime.refresh({ allowNetwork: false });
  // What a send does first: a read-only session is opened again.
  await sessions.ensure(id);
  assert.equal(sessions.list().find((row) => row.id === id)?.readOnly, undefined);
  assert.equal((await sessions.start(id, "back").completion).outcome, "completed");
});

test("read-only: a missing folder or agent opens to be read; a new session still fails", async (t) => {
  const { root, home, sessions, withHistory } = await setup(t);
  const folder = join(root, "project");
  await mkdir(folder);
  const inFolder = await withHistory(folder);
  await rm(folder, { recursive: true, force: true });
  const opened = await sessions.open(inFolder);
  assert.equal(opened.readOnly, "folder");
  assert.equal(sessions.items(inFolder, {}).items.length, 2);

  const ofAgent = await withHistory();
  const file = join(home, "sessions", ofAgent, "session.json");
  const metadata = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...metadata, agent: "no-such-agent" }));
  await sessions.reload(ofAgent).catch(() => {});
  const { readOnly } = sessions.list().find((row) => row.id === ofAgent)!;
  assert.equal(readOnly, "agent");

  await assert.rejects(sessions.create({ folder: join(root, "missing"), model }), code("folder"));
});
