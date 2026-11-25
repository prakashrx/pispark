import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { PROCESS_TOOL, validProcessMessage } from "../src/core/runtime/process-tool.js";
import { gitPs } from "../src/core/runtime/processes.js";
import { STATUS_ENTRY, WOKEN_ENTRY } from "../src/contract/wake-protocol.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome, writeAgent } from "./fixtures/home.js";

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

test("wait returns only status; search finds early literal evidence without consuming output", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    const run = async (args: object) => {
      await f.runtime.start(session.id, call(args)).completion;
      return f.lastTool(f.runtime, session.id);
    };
    await run({ action: "start", command: SERVER, report: "none" });
    const [server] = f.runtime.listProcesses(session.id);
    const started = f.runtime.items(session.id, {}).items.filter((item) => item.role === "toolResult").at(-1);
    assert.deepEqual(started?.details, { id: server!.id });
    assert.equal(await run({ action: "wait", id: server!.id, timeout_seconds: 1 }), `${server!.id}: running (wait timed out)`);
    await run({ action: "stop", id: server!.id });

    // Write the diagnostic and enough later output to hide it from the tail. Release the
    // command only after start moved its unread cursor past the ready line.
    const command = `node -e "const f=require('fs'); console.log('ready'); const t=setInterval(()=>{if(!f.existsSync('release'))return; clearInterval(t); console.log('not ok [41]'); console.log('expected 41, got 43'); console.log('later\\n'.repeat(4000)); console.log('last line'); process.exitCode=23},25)"`;
    await run({ action: "start", command, report: "none", wait_for: "ready", timeout_seconds: 10 });
    const process = f.runtime.listProcesses(session.id).find((p) => p.id !== server!.id)!;
    writeFileSync(join(f.folder, "release"), "");
    assert.equal(await run({ action: "wait", id: process.id, timeout_seconds: 10 }), `${process.id}: failed (exit 23)`);
    assert.doesNotMatch(f.runtime.processOutput(session.id, process.id, 20_000).text, /not ok/);
    assert.equal(await run({ action: "search", id: process.id, query: "NOT OK [41]" }), "  1: ready\n> 2: not ok [41]\n  3: expected 41, got 43");
    assert.match(await run({ action: "search", id: process.id, query: "later" }), /first 5 matching lines/);
    assert.equal(await run({ action: "search", id: process.id, query: ".*" }), "No match in the retained log.");
    assert.match((await run({ action: "output", id: process.id })).split("\n").slice(1).join("\n"), /^not ok \[41\]\nexpected 41, got 43/);
    assert.ok(!f.runtime.items(session.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
  } finally {
    await f.cleanup();
  }
});

test("a process runs in the background, outlives its idle session, streams its output, and tells the session when stopped", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(session.id, call({ action: "start", command: SERVER, title: "dev server", report: "status", wait_for: "ready on", timeout_seconds: 20 })).completion;
    const started = f.lastTool(f.runtime, session.id);
    assert.match(started, /^Started .*dev server/);
    assert.match(started, /The output shows \/ready on\//);
    assert.match(started, /ready on 5173/);
    const [process] = f.runtime.listProcesses(session.id);
    assert.equal(process!.state, "running");
    assert.equal(f.runtime.list().find((s) => s.id === session.id)?.processes, 1);

    // The session unloads; the process keeps running and its output keeps coming.
    await f.runtime.stop(session.id);
    const first = f.runtime.processOutput(session.id, process!.id, 0);
    await eventually(() => f.runtime.processOutput(session.id, process!.id, first.next).text.includes("tick"), 10_000);
    assert.equal(f.runtime.runningProcesses().processes[0]?.id, process!.id);

    // The agent reads only what it has not read yet.
    await f.runtime.ensure(session.id);
    await f.runtime.start(session.id, call({ action: "output", id: process!.id })).completion;
    // After the line describing the process (which quotes the command).
    const read = f.lastTool(f.runtime, session.id).split("\n").slice(1).join("\n");
    assert.ok(!read.includes("ready on 5173"), `earlier output is not repeated: ${read.slice(0, 300)}`);
    assert.match(read, /tick/);

    // The person stops it; in status mode the session gets a line, no turn.
    f.runtime.stopProcess(session.id, process!.id);
    await eventually(() => f.runtime.listProcesses(session.id)[0]!.state === "stopped", 10_000);
    await eventually(() => f.runtime.items(session.id, {}).items.some((item) => item.customType === STATUS_ENTRY), 10_000);
    const line = f.runtime.items(session.id, {}).items.find((item) => item.customType === STATUS_ENTRY)!;
    assert.deepEqual(line.details, { process: process!.id, title: "dev server", how: "was stopped", ok: false });
  } finally {
    await f.cleanup();
  }
});

test("a failing command wakes its session with the exit code and its last output", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(session.id, call({ action: "start", command: FAILING, title: "tests" })).completion;
    await eventually(() => f.runtime.items(session.id, {}).items.some((item) => item.customType === WOKEN_ENTRY), 15_000);
    const items = f.runtime.items(session.id, {}).items;
    const woken = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.equal((items[woken]!.details as { source: { kind: string; label: string } }).source.label, "tests · exited 1");
    assert.match(text(items[woken + 1]!), /^The process "tests" exited 1\.\n\nLast output:\n1 failed, 212 passed/);
    const { card } = items[woken]!.details as { card: { title: string; how: string; start: number } };
    assert.deepEqual({ title: card.title, how: card.how }, { title: "tests", how: "exited 1" });
    assert.match(text(items[woken + 1]!).slice(card.start), /^1 failed, 212 passed/);
  } finally {
    await f.cleanup();
  }
});

test("processes end when PiSpark stops; after the restart their session is told", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(session.id, call({ action: "start", command: SERVER, title: "dev server", wait_for: "ready", timeout_seconds: 20 })).completion;
    await f.runtime.shutdown();
    const again = f.make();
    assert.equal(again.listProcesses(session.id)[0]!.ended, "pispark-stopped");
    await eventually(() => {
      try {
        return again.items(session.id, {}).items.some((item) => item.customType === WOKEN_ENTRY);
      } catch {
        return false;
      }
    }, 15_000);
    const items = again.items(session.id, {}).items;
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
    const session = await f.runtime.create({ folder });
    await f.runtime.start(session.id, call({ action: "start", command: "npm run dev", wait_for: "ready", timeout_seconds: 60 })).completion;
    const [process] = f.runtime.listProcesses(session.id);
    assert.equal(process!.state, "running");
    f.runtime.stopProcess(session.id, process!.id);
    // It ends only once every process holding its output has gone.
    await eventually(() => f.runtime.listProcesses(session.id)[0]!.state === "stopped", 20_000);
  } finally {
    await f.cleanup();
  }
});

test("the agent's stop answers once the process has ended", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(session.id, call({ action: "start", command: SERVER, wait_for: "ready", timeout_seconds: 30 })).completion;
    const [process] = f.runtime.listProcesses(session.id);
    await f.runtime.start(session.id, call({ action: "stop", id: process!.id })).completion;
    assert.equal(f.lastTool(f.runtime, session.id), "Stopped.");
    assert.equal(f.runtime.listProcesses(session.id)[0]!.state, "stopped");
  } finally {
    await f.cleanup();
  }
});

const GIT = String.raw`C:\Program Files\Git`;
test("Windows: Stop finds Git's ps.exe from either Git Bash, and none for another bash", { skip: process.platform !== "win32" || !existsSync(join(GIT, "usr", "bin", "ps.exe")) }, () => {
  const ps = join(GIT, "usr", "bin", "ps.exe");
  assert.equal(gitPs(join(GIT, "bin", "bash.exe")), ps);
  assert.equal(gitPs(join(GIT, "usr", "bin", "bash.exe")), ps);
  assert.equal(gitPs(String.raw`C:\Windows\System32\bash.exe`), undefined);
});

test("a status-only process result survives reload and restart without invoking a model", async () => {
  const f = await fixture();
  try {
    const name = "status-only";
    await writeAgent(f.home, name, { name: "Status only" }, {
      "extensions/status.mjs": `export default (pi) => {
        let started = false;
        pi.on("session_start", (event) => {
          if (started || event.reason !== "new") return;
          started = true;
          setTimeout(() => pi.events.emit("pispark:process-request", {
            request: { action: "start", command: "node --version", title: "Version", report: "status" },
            reply: () => {}
          }), 50);
        });
      }`,
    });
    const session = await f.runtime.create({ folder: f.folder, agent: name });
    const statuses = (r: SessionRuntime) => r.items(session.id, {}).items.filter((item) => item.customType === STATUS_ENTRY);
    await eventually(() => statuses(f.runtime).length === 1, 10_000);
    await f.runtime.shutdown();
    const reopened = f.make();
    await reopened.open(session.id);
    const items = reopened.items(session.id, {}).items;
    assert.equal(statuses(reopened).length, 1);
    assert.ok(items.every((item) => item.role !== "user" && item.role !== "assistant"));
    assert.equal(f.provider.requests.length, 0);
  } finally {
    await f.cleanup();
  }
});
