import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localProviderSettings } from "./fixtures/provider-settings.js";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";

const provider = "pispark-local-test";

test("last activity: when a session last did something, not when it was opened", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-activity-"));
  const f = await localProviderSettings(root);
  f.control.automatic = true;
  await writeFile(f.authPath, JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }));
  await f.runtime.refresh({ allowNetwork: false });
  const sessions = new SessionRuntime({ home: join(root, "pispark") }, f.settings);
  t.after(async () => {
    await sessions.shutdown();
    await f.settings.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const row = (id: string) => sessions.list().find((each) => each.id === id)!;
  const { id } = await sessions.create({ folder: root, model: { provider, id: "deterministic" } });
  // Nothing yet: it last did something when it started.
  assert.equal(row(id).lastActivity, row(id).createdAt);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await sessions.start(id, "hello").completion).outcome, "completed");
  const replied = row(id).lastActivity;
  assert(replied > row(id).createdAt);
  // Opening it again (or only reading it) isn't activity.
  await sessions.stop(id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await sessions.open(id);
  assert(Math.abs(Date.parse(row(id).lastActivity) - Date.parse(replied)) < 1000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await sessions.start(id, "again").completion;
  assert(row(id).lastActivity > replied);
});
