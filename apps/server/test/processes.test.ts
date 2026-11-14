import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { PROCESS_TOOL, validProcessMessage } from "../src/core/runtime/process-tool.js";
import { STATUS_ENTRY, WOKEN_ENTRY } from "../src/contract/wake-protocol.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";

const call = (args: object) => `tool:${PROCESS_TOOL}:${JSON.stringify(args)}`;
const text = (item: { parts: { type: string; text?: string }[] }) => item.parts.map((part) => part.text ?? "").join("");
const SERVER = `node -e "console.log('ready on 5173'); setInterval(() => console.log('tick'), 50)"`;
const FAILING = `node -e "console.log('1 failed, 212 passed'); process.exit(1)"`;

async function fixture() {
  const h = await testHome("pispark-processes-");
  h.provider.automatic = true;
  const runtimes: SessionRuntime[] = [];
  const make = () => {
    const runtime = new SessionRuntime({ ...h.configuration, wakeTickMs: 0 });
    runtimes.push(runtime);
    return runtime;
  };
  const folder = await h.folder("work");
  return {
    ...h,
    runtime: make(),
    make,
    folder,
    lastTool: (runtime: SessionRuntime, id: string) => text(runtime.items(id, {}).items.filter((item) => item.role === "toolResult").at(-1)!),
    cleanup: async () => {
      await Promise.allSettled(runtimes.map((r) => r.shutdown()));
      await h.remove();
    },
  };
}

test("a wait always comes with a time limit", () => {
  const reply = () => {};
  assert.equal(validProcessMessage({ request: { action: "start", command: "x", waitFor: "ready" }, reply }), false);
  assert.equal(validProcessMessage({ request: { action: "output", id: "x", timeoutSeconds: 5 }, reply }), false);
  assert.equal(validProcessMessage({ request: { action: "start", command: "x", waitFor: "ready", timeoutSeconds: 5 }, reply }), true);
});

test("a process runs in the background, outlives its idle session, streams its output, and tells the session when stopped", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(chat.id, call({ action: "start", command: SERVER, title: "dev server", report: "status", wait_for: "ready on", timeout_seconds: 20 })).completion;
    const started = f.lastTool(f.runtime, chat.id);
    assert.match(started, /^Started .*dev server/);
    assert.match(started, /The output shows \/ready on\//);
    assert.match(started, /ready on 5173/);
    const [process] = f.runtime.listProcesses(chat.id);
    assert.equal(process!.state, "running");
    assert.equal(f.runtime.list().find((s) => s.id === chat.id)?.processes, 1);

    // The session unloads; the process keeps running and its output keeps coming.
    await f.runtime.stop(chat.id);
    const first = f.runtime.processOutput(chat.id, process!.id, 0);
    await eventually(() => f.runtime.processOutput(chat.id, process!.id, first.next).text.includes("tick"), 10_000);
    assert.equal(f.runtime.runningProcesses().processes[0]?.id, process!.id);

    // The agent reads only what it has not read yet.
    await f.runtime.ensure(chat.id);
    await f.runtime.start(chat.id, call({ action: "output", id: process!.id })).completion;
    // After the line describing the process (which quotes the command).
    const read = f.lastTool(f.runtime, chat.id).split("\n").slice(1).join("\n");
    assert.ok(!read.includes("ready on 5173"), `earlier output is not repeated: ${read.slice(0, 300)}`);
    assert.match(read, /tick/);

    // The person stops it; in status mode the session gets a line, no turn.
    f.runtime.stopProcess(chat.id, process!.id);
    await eventually(() => f.runtime.listProcesses(chat.id)[0]!.state === "stopped", 10_000);
    await eventually(() => f.runtime.items(chat.id, {}).items.some((item) => item.customType === STATUS_ENTRY), 10_000);
    const line = f.runtime.items(chat.id, {}).items.find((item) => item.customType === STATUS_ENTRY)!;
    assert.deepEqual(line.details, { process: process!.id, title: "dev server", how: "was stopped" });
  } finally {
    await f.cleanup();
  }
});

test("a failing command wakes its session with the exit code and its last output", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(chat.id, call({ action: "start", command: FAILING, title: "tests" })).completion;
    await eventually(() => f.runtime.items(chat.id, {}).items.some((item) => item.customType === WOKEN_ENTRY), 15_000);
    const items = f.runtime.items(chat.id, {}).items;
    const woken = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.equal((items[woken]!.details as { source: { kind: string; label: string } }).source.label, "tests · exited 1");
    assert.match(text(items[woken + 1]!), /^The process "tests" exited 1\.\n\nLast output:\n1 failed, 212 passed/);
  } finally {
    await f.cleanup();
  }
});

test("processes end when PiSpark stops; after the restart their session is told", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(chat.id, call({ action: "start", command: SERVER, title: "dev server", wait_for: "ready", timeout_seconds: 20 })).completion;
    await f.runtime.shutdown();
    const again = f.make();
    assert.equal(again.listProcesses(chat.id)[0]!.ended, "pispark-stopped");
    await eventually(() => {
      try {
        return again.items(chat.id, {}).items.some((item) => item.customType === WOKEN_ENTRY);
      } catch {
        return false;
      }
    }, 15_000);
    const items = again.items(chat.id, {}).items;
    const woken = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.match(text(items[woken + 1]!), /^The process "dev server" ended when PiSpark stopped\./);
  } finally {
    await f.cleanup();
  }
});

test("Stop ends everything a command started, such as npm and the server it runs", async () => {
  const f = await fixture();
  try {
    const folder = join(f.root, "shop");
    mkdirSync(folder);
    writeFileSync(join(folder, "package.json"), JSON.stringify({ name: "shop", private: true, scripts: { dev: "node dev.js" } }));
    writeFileSync(join(folder, "dev.js"), "console.log('ready'); setInterval(() => console.log('tick'), 100);");
    const chat = await f.runtime.create({ folder });
    await f.runtime.start(chat.id, call({ action: "start", command: "npm run dev", wait_for: "ready", timeout_seconds: 60 })).completion;
    const [process] = f.runtime.listProcesses(chat.id);
    assert.equal(process!.state, "running");
    f.runtime.stopProcess(chat.id, process!.id);
    // It ends only once every process holding its output has gone.
    await eventually(() => f.runtime.listProcesses(chat.id)[0]!.state === "stopped", 20_000);
  } finally {
    await f.cleanup();
  }
});
