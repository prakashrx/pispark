import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { addViewExtension, testHome } from "./fixtures/home.js";
import { chatText } from "./fixtures/chat.js";
import { eventually } from "./fixtures/local-provider.js";

/** Chats whose extension can have the agent work (the view fixture's `ask` and `nudge` calls). */
async function fixture(maxRunning: number) {
  const h = await testHome("pispark-extension-runs-");
  await h.persona("default", { name: "Default" });
  await addViewExtension(h.home, "default");
  const runtime = new SessionRuntime({ ...h.configuration, maxRunning });
  const folder = await h.folder("work");
  return {
    ...h,
    runtime,
    create: () => runtime.create({ folder }),
    saved: async (id: string) => JSON.parse(await readFile(join(h.home, "chats", id, "chat.json"), "utf8")),
    /** The extension starts a run, as a page's button would. */
    ask: (id: string, text: string, how: "ask" | "nudge" = "ask") => runtime.call(id, "chat.header", "", how, text),
    cleanup: async () => {
      h.provider.automatic = true;
      for (const request of h.provider.requests) request.release();
      await runtime.shutdown();
      await h.remove();
    },
  };
}

test("a run an extension starts is a run: it shows as running, is saved as active, and settles", async () => {
  const f = await fixture(2);
  try {
    const chat = await f.create();
    assert.equal(await f.ask(chat.id, "from the page"), true);
    await eventually(() => f.provider.requests.length === 1);
    assert.equal(f.runtime.session(chat.id).status, "running");
    assert.equal(f.runtime.list().find((c) => c.id === chat.id)?.status, "running");
    assert.equal((await f.saved(chat.id)).active, true, "marked before the model was called");
    // The chat is busy for a new prompt, and the run can be steered like any other.
    assert.throws(() => f.runtime.start(chat.id, "another"), /busy/);

    f.provider.requests[0]!.release();
    await eventually(() => f.runtime.session(chat.id).status === "idle");
    assert.equal((await f.saved(chat.id)).active, false);
    assert.equal(f.runtime.session(chat.id).error, undefined);
    assert.match(chatText(f.runtime, chat.id), /from the page/);

    // A custom message that starts a turn is a run too, and a prompt works afterwards.
    await f.ask(chat.id, "a nudge", "nudge");
    await eventually(() => f.provider.requests.length === 2);
    assert.equal(f.runtime.session(chat.id).status, "running");
    f.provider.requests[1]!.release();
    await eventually(() => f.runtime.session(chat.id).status === "idle");
    const run = f.runtime.start(chat.id, "typed");
    await eventually(() => f.provider.requests.length === 3);
    f.provider.requests[2]!.release();
    assert.deepEqual(await run.completion, { outcome: "completed" });
  } finally {
    await f.cleanup();
  }
});

test("a run an extension starts takes a run slot, and waits for one past the limit", async () => {
  const f = await fixture(1);
  try {
    const [a, b, c] = [await f.create(), await f.create(), await f.create()];
    const runA = f.runtime.start(a.id, "first");
    await eventually(() => f.provider.requests.length === 1);

    // b's extension starts a run while a holds the only slot: it waits, and nothing reaches the model.
    await f.ask(b.id, "second, from the page");
    await eventually(() => f.runtime.session(b.id).status === "running");
    assert.equal(f.runtime.session(b.id).queued, true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(f.provider.requests.length, 1);

    // It holds the slot once it has it: a prompt in a third chat waits behind it.
    f.provider.requests[0]!.release();
    assert.deepEqual(await runA.completion, { outcome: "completed" });
    await eventually(() => f.provider.requests.length === 2);
    assert.equal(f.runtime.session(b.id).queued, undefined);
    const runC = f.runtime.start(c.id, "third");
    assert.equal(f.runtime.session(c.id).status, "queued");
    f.provider.requests[1]!.release();
    await eventually(() => f.provider.requests.length === 3);
    f.provider.requests[2]!.release();
    assert.deepEqual(await runC.completion, { outcome: "completed" });
    assert.equal(f.runtime.session(b.id).status, "idle");
  } finally {
    await f.cleanup();
  }
});

test("a run an extension starts can be stopped, while it works and while it waits for a slot", async () => {
  const f = await fixture(1);
  try {
    const [a, b] = [await f.create(), await f.create()];
    // While it works.
    await f.ask(a.id, "stop me");
    await eventually(() => f.provider.requests.length === 1);
    await f.runtime.cancel(a.id);
    assert.equal(f.runtime.session(a.id).status, "idle");
    assert.equal(f.runtime.session(a.id).error, undefined);
    assert.equal((await f.saved(a.id)).active, false);

    // While it waits for a slot: it never reaches the model, and the slot's holder is unaffected.
    const runA = f.runtime.start(a.id, "holds the slot");
    await eventually(() => f.provider.requests.length === 2);
    await f.ask(b.id, "never sent");
    await eventually(() => f.runtime.session(b.id).queued === true);
    await f.runtime.cancel(b.id);
    assert.equal(f.runtime.session(b.id).status, "idle");
    assert.equal(f.runtime.session(b.id).queued, undefined);
    assert.equal(f.provider.requests.length, 2);
    f.provider.requests[1]!.release();
    assert.deepEqual(await runA.completion, { outcome: "completed" });
  } finally {
    await f.cleanup();
  }
});
