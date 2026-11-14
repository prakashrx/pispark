import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";

// An extension with live work of its own: it asks to keep its session loaded when the session starts.
const HOLDER = `
export default function (pi) {
  pi.on("session_start", () => {
    pi.events.emit("pispark:hold", {
      extension: "holder",
      hold: true,
      reason: "listening for test messages",
      reply: (answer) => (globalThis.__holdAnswers ??= []).push(answer.state),
    });
  });
  pi.on("session_shutdown", () => (globalThis.__holderStops = (globalThis.__holderStops ?? 0) + 1));
}
`;
const answers = () => ((globalThis as { __holdAnswers?: string[] }).__holdAnswers ??= []);

async function fixture() {
  const h = await testHome("pispark-hold-");
  h.provider.automatic = true;
  await h.persona("bot", { name: "Bot" }, { "extensions/holder.mjs": HOLDER });
  const runtimes: SessionRuntime[] = [];
  const make = () => {
    const runtime = new SessionRuntime({ ...h.configuration, wakeTickMs: 0, idleUnloadMs: 100 });
    runtimes.push(runtime);
    return runtime;
  };
  const folder = await h.folder("work");
  return {
    ...h,
    runtime: make(),
    make,
    folder,
    status: (runtime: SessionRuntime, id: string) => runtime.list().find((s) => s.id === id)?.status,
    cleanup: async () => {
      await Promise.allSettled(runtimes.map((r) => r.shutdown()));
      await h.remove();
    },
  };
}

test("an extension asks to hold its session; the person allows it for the persona; it stays loaded", async () => {
  const f = await fixture();
  answers().length = 0;
  try {
    const bot = await f.runtime.create({ folder: f.folder, persona: "bot" });
    // Not allowed yet: the person is asked, and the extension told.
    assert.deepEqual(answers(), ["asked"]);
    assert.deepEqual(f.runtime.session(bot.id).holdAsked, { extension: "holder", reason: "listening for test messages" });
    assert.equal(f.runtime.list().find((s) => s.id === bot.id)?.held, undefined);

    f.runtime.answerHold(bot.id, true);
    const persona = JSON.parse(await readFile(join(f.home, "personas", "bot", "persona.json"), "utf8"));
    assert.deepEqual(persona.on, ["hold:holder"]);
    assert.deepEqual(f.runtime.list().find((s) => s.id === bot.id)?.held, { extension: "holder", reason: "listening for test messages" });
    assert.equal(f.runtime.session(bot.id).holdAsked, undefined);

    // Idle and unwatched: an ordinary session unloads; the held one stays.
    const plain = await f.runtime.create({ folder: f.folder });
    await eventually(() => f.status(f.runtime, plain.id) === "unloaded", 5000);
    assert.equal(f.status(f.runtime, bot.id), "idle");

    // Allowed for the persona: its next session holds at once.
    const second = await f.runtime.create({ folder: f.folder, persona: "bot" });
    assert.equal(answers().at(-1), "held");
    f.runtime.releaseHold(second.id);
    await eventually(() => f.status(f.runtime, second.id) === "unloaded", 5000);

    // Pause all unloads it; resuming loads it again.
    f.runtime.updateSettings({ unattendedPaused: true });
    await eventually(() => f.status(f.runtime, bot.id) === "unloaded");
    f.runtime.updateSettings({ unattendedPaused: false });
    await eventually(() => f.status(f.runtime, bot.id) === "idle");

    // After a restart it is loaded again, and its extension starts its work again.
    await f.runtime.shutdown();
    const again = f.make();
    await again.checkWakes();
    await eventually(() => f.status(again, bot.id) === "idle");
    assert.equal(answers().at(-1), "held");

    // Archiving lets go.
    await again.archive(bot.id);
    assert.equal(again.archived().find((s) => s.id === bot.id)?.held, undefined);
  } finally {
    await f.cleanup();
  }
});

test("Not now forgets the hold request and switches nothing on", async () => {
  const f = await fixture();
  answers().length = 0;
  try {
    const bot = await f.runtime.create({ folder: f.folder, persona: "bot" });
    f.runtime.answerHold(bot.id, false);
    assert.equal(f.runtime.session(bot.id).holdAsked, undefined);
    assert.equal(f.runtime.list().find((s) => s.id === bot.id)?.held, undefined);
    const persona = JSON.parse(await readFile(join(f.home, "personas", "bot", "persona.json"), "utf8"));
    assert.equal(persona.on, undefined);
  } finally {
    await f.cleanup();
  }
});
