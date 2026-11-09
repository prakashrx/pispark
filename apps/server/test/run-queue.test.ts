import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { SessionHttp } from "../src/session-http.js";
import { createAppServer } from "../src/server.js";
import { SessionRuntime } from "../src/runtime/session-runtime.js";
import { addControlledExtension, testHome } from "./fixtures/home.js";
import { eventually } from "./fixtures/local-provider.js";

async function fixture(maxRunning: number) {
  const h = await testHome("pispark-queue-");
  await h.persona("default", { name: "Default" });
  await addControlledExtension(h.home, "default");
  const runtime = new SessionRuntime({ ...h.configuration, maxRunning });
  const folder = await h.folder("work");
  const saved = async (id: string) => JSON.parse(await readFile(join(h.home, "chats", id, "chat.json"), "utf8"));
  return {
    ...h,
    runtime,
    create: () => runtime.create({ folder }),
    saved,
    cleanup: async () => {
      h.provider.automatic = true;
      for (const request of h.provider.requests) request.release();
      await runtime.shutdown();
      await h.remove();
    },
  };
}

test("past the limit a prompt waits for a turn, in order, saved with its chat; cancelling takes it off", async () => {
  const f = await fixture(1);
  try {
    const [a, b, c] = [await f.create(), await f.create(), await f.create()];
    const runA = f.runtime.start(a.id, "first");
    assert.equal(f.runtime.session(a.id).status, "running");
    await eventually(() => f.provider.requests.length === 1);

    const runB = f.runtime.start(b.id, "second");
    const runC = f.runtime.start(c.id, "third");
    for (const id of [b.id, c.id]) {
      assert.equal(f.runtime.session(id).status, "queued");
      assert.equal(f.runtime.session(id).queued, true);
    }
    assert.equal((await f.saved(b.id)).queued, "second", "a waiting prompt is saved with its chat");
    assert.equal(f.runtime.list().find((chat) => chat.id === c.id)?.queued, true);
    assert.equal(f.provider.requests.length, 1, "nothing else reached the model");

    // Cancelling a waiting prompt takes it off the queue and out of the chat's file.
    await f.runtime.cancel(c.id);
    assert.deepEqual(await runC.completion, { outcome: "cancelled" });
    assert.equal(f.runtime.session(c.id).status, "idle");
    assert.equal((await f.saved(c.id)).queued, undefined);

    // When the running chat finishes, the next one starts.
    f.provider.requests[0]!.release();
    assert.deepEqual(await runA.completion, { outcome: "completed" });
    await eventually(() => f.runtime.session(b.id).status === "running");
    assert.equal((await f.saved(b.id)).queued, undefined);
    await eventually(() => f.provider.requests.length === 2);
    f.provider.requests[1]!.release();
    assert.deepEqual(await runB.completion, { outcome: "completed" });
    assert.match(JSON.stringify(f.provider.requests[1]!.context), /second/);
  } finally {
    await f.cleanup();
  }
});

test("a chat waiting on a question gives its slot up, and goes first when answered", async () => {
  const f = await fixture(1);
  try {
    const [a, b, c] = [await f.create(), await f.create(), await f.create()];
    // The controlled extension asks before the model is called.
    const runA = f.runtime.start(a.id, "ui-select");
    await eventually(() => f.runtime.session(a.id).extensions.dialogs.length === 1);
    assert.equal(f.runtime.session(a.id).queued, undefined);

    // Its slot is free while it waits for a person.
    const runB = f.runtime.start(b.id, "second");
    assert.equal(f.runtime.session(b.id).status, "running");
    const runC = f.runtime.start(c.id, "third");
    assert.equal(f.runtime.session(c.id).status, "queued");

    // Answered while b runs: a waits for a slot, ahead of c.
    const dialog = f.runtime.session(a.id).extensions.dialogs[0]!;
    f.runtime.answer(a.id, dialog.id, "two");
    assert.equal(f.runtime.session(a.id).extensions.dialogs.length, 0);
    assert.equal(f.runtime.session(a.id).queued, true);
    assert.equal(f.runtime.session(a.id).status, "running");

    await eventually(() => f.provider.requests.length === 1);
    f.provider.requests[0]!.release();
    assert.deepEqual(await runB.completion, { outcome: "completed" });
    await eventually(() => f.provider.requests.length === 2);
    assert.equal(f.runtime.session(a.id).queued, undefined);
    assert.equal(f.runtime.session(c.id).status, "queued", "the resumed run went first");
    f.provider.requests[1]!.release();
    assert.deepEqual(await runA.completion, { outcome: "completed" });
    await eventually(() => f.runtime.session(c.id).status === "running");
    await eventually(() => f.provider.requests.length === 3);
    f.provider.requests[2]!.release();
    assert.deepEqual(await runC.completion, { outcome: "completed" });
  } finally {
    await f.cleanup();
  }
});

test("cancelling a run that waits for a slot after an answer ends it at once", async () => {
  const f = await fixture(1);
  try {
    const [a, b] = [await f.create(), await f.create()];
    const runA = f.runtime.start(a.id, "ui-select");
    await eventually(() => f.runtime.session(a.id).extensions.dialogs.length === 1);
    const runB = f.runtime.start(b.id, "busy");
    const dialog = f.runtime.session(a.id).extensions.dialogs[0]!;
    f.runtime.answer(a.id, dialog.id, "one");
    assert.equal(f.runtime.session(a.id).queued, true);
    await f.runtime.cancel(a.id);
    assert.equal((await runA.completion).outcome, "cancelled");
    assert.equal(f.runtime.session(a.id).queued, undefined);
    await eventually(() => f.provider.requests.length === 1);
    f.provider.requests[0]!.release();
    assert.deepEqual(await runB.completion, { outcome: "completed" });
  } finally {
    await f.cleanup();
  }
});

test("the run limit is a setting: saved in the data folder, applied at once, validated", async () => {
  const h = await testHome("pispark-queue-settings-");
  await h.persona("default", { name: "Default" });
  const runtimes: SessionRuntime[] = [];
  const make = () => {
    const runtime = new SessionRuntime(h.configuration);
    runtimes.push(runtime);
    return runtime;
  };
  try {
    const runtime = make();
    assert.deepEqual(runtime.settings(), { maxRunning: 8 });
    assert.deepEqual(runtime.updateSettings({ maxRunning: 1 }), { maxRunning: 1 });
    assert.deepEqual(JSON.parse(await readFile(join(h.home, "settings.json"), "utf8")), { maxRunning: 1 });
    for (const bad of [{ maxRunning: 0 }, { maxRunning: 33 }, { maxRunning: 1.5 }, { maxRunning: 2, extra: 1 }, {}, null])
      assert.throws(() => runtime.updateSettings(bad), (error: { code?: string }) => error.code === "invalid-input");

    // With one slot, a second prompt waits; raising the limit starts it.
    const folder = await h.folder("work");
    const [a, b] = [await runtime.create({ folder }), await runtime.create({ folder })];
    const runA = runtime.start(a.id, "first");
    const runB = runtime.start(b.id, "second");
    assert.equal(runtime.session(b.id).status, "queued");
    runtime.updateSettings({ maxRunning: 2 });
    assert.equal(runtime.session(b.id).status, "running");
    h.provider.automatic = true;
    await eventually(() => h.provider.requests.length === 2);
    for (const request of h.provider.requests) request.release();
    await Promise.all([runA.completion, runB.completion]);
    await runtime.shutdown();

    // A new start reads the saved setting.
    assert.deepEqual(make().settings(), { maxRunning: 2 });
  } finally {
    await Promise.allSettled(runtimes.map((r) => r.shutdown()));
    await h.remove();
  }
});

test("settings over HTTP: read, change, refuse a bad value", async () => {
  const h = await testHome("pispark-queue-http-");
  const runtime = new SessionRuntime(h.configuration);
  const http = new SessionHttp(runtime);
  const server = createAppServer({ sessions: http });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (body: unknown) =>
      fetch(`${base}/api/settings`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body) });
    assert.deepEqual(await (await fetch(`${base}/api/settings`)).json(), { maxRunning: 8 });
    const saved = await post({ maxRunning: 3 });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { maxRunning: 3 });
    assert.equal((await post({ maxRunning: "3" })).status, 400);
    assert.deepEqual(await (await fetch(`${base}/api/settings`)).json(), { maxRunning: 3 });
  } finally {
    await http.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await h.remove();
  }
});
