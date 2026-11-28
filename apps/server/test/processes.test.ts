import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { validVerb } from "../src/core/runtime/verbs.js";
import { gitPs } from "../src/core/runtime/processes.js";
import { STATUS_ENTRY, WOKEN_ENTRY } from "../src/contract/wake-protocol.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome, writeAgent } from "./fixtures/home.js";
import { say, steps } from "./fixtures/verbs.js";

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
    /** A prompt for the session's agent, and what the last tool it called answered. */
    run: async (id: string, prompt: string) => {
      await runtimes[0]!.start(id, prompt).completion;
      return text(
        runtimes[0]!
          .items(id, {})
          .items.filter((item) => item.role === "toolResult")
          .at(-1)!,
      );
    },
    cleanup: async () => {
      await Promise.allSettled(runtimes.map((r) => r.shutdown()));
      await h.remove();
    },
  };
}

test("a verb is checked the same way whoever sent it", () => {
  assert.equal(validVerb({ verb: "start_process", command: "npm test", raise_on: "error|failed" }), true);
  assert.equal(validVerb({ verb: "start_process", command: "npm test", raise_on: "(" }), false, "a pattern must be a regular expression");
  assert.equal(validVerb({ verb: "wait" }), true, "a wait needs nothing: it has no longest time");
  assert.equal(validVerb({ verb: "wait", ids: [] }), false);
  assert.equal(validVerb({ verb: "send", id: "process-1", raise_on: "" }), true, "an empty pattern clears it");
  assert.equal(validVerb({ verb: "send", id: "session-1", text: "go on", raise_on: "x" }), false, "text or raise_on, not both");
  assert.equal(validVerb({ verb: "schedule", prompt: "tidy", cron: "0 9 * * *", in_minutes: 5 }), false, "one time, not two");
  assert.equal(validVerb({ verb: "report", text: "x" }), false);
});

test("wait takes a process's result, look reads what is unread, and find searches without reading", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    const run = (prompt: string) => f.run(session.id, prompt);
    assert.match(await run(say("start_process", { command: SERVER })), /^Started process-1: .* — running since .*\nready on 5173/);
    const [server] = f.runtime.listProcesses(session.id);
    const started = f.runtime
      .items(session.id, {})
      .items.filter((item) => item.role === "toolResult")
      .at(-1);
    assert.deepEqual(started?.details, { id: server!.id });
    // A wait gives up after its own time; what it waited for stays open.
    assert.equal(await run(say("wait", { ids: ["process-1"], seconds: 1 })), "Not in within 1 s. Still open: process-1.");
    assert.equal(await run(say("stop", { id: "process-1" })), "Stopped.");

    // It prints a diagnostic and then enough output to push it out of the tail, once released.
    const command = `node -e "const f=require('fs'); console.log('ready'); const t=setInterval(()=>{if(!f.existsSync('release'))return; clearInterval(t); console.log('not ok [41]'); console.log('expected 41, got 43'); console.log('later\\n'.repeat(4000)); console.log('last line'); process.exitCode=23},25)"`;
    // Waiting for a line the start already showed returns at once: the start's first output stays unread.
    const ready = await run(steps(["start_process", { command }], ["wait", { ids: ["process-2"], until: "ready", seconds: 10 }]));
    assert.match(ready, /^process-2: .* — running since .*\nThe output shows \/ready\/i\.\nready/);
    writeFileSync(join(f.folder, "release"), "");
    // Waiting for its end gives what its session would have been sent: how it ended and its last output.
    const ended = await run(say("wait", { ids: ["process-2"], seconds: 20 }));
    assert.match(ended, /^process-2: .* — failed \(exit 23\)\nLast output:\n/);
    assert.match(ended, /last line$/);
    assert.doesNotMatch(ended.split("Last output:\n")[1]!, /not ok/);
    // find searches the whole retained output, and moves nothing.
    const found = (await run(say("look", { id: "process-2", find: "NOT OK [41]" }))).split("\n").slice(1).join("\n");
    assert.equal(found, "  1: ready\n> 2: not ok [41]\n  3: expected 41, got 43");
    assert.match(await run(say("look", { id: "process-2", find: "later" })), /first 5 matching lines/);
    assert.match(await run(say("look", { id: "process-2", find: ".*" })), /No match in the retained log\.$/);
    // look reads on from where its session last read.
    assert.match((await run(say("look", { id: "process-2" }))).split("\n").slice(1).join("\n"), /^not ok \[41\]\nexpected 41, got 43/);
    assert.match(await run(say("look")), /^process-1: .* — stopped.*\nprocess-2: .* — failed \(exit 23\)$/);
    // Both ends were taken (one stopped by the agent, one waited for): nothing was sent to the session.
    assert.ok(!f.runtime.items(session.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
  } finally {
    await f.cleanup();
  }
});

test("wait for any returns with the first result and leaves the rest open; with nothing open it says so", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    const quick = `node -e "setTimeout(() => console.log('quick done'), 300)"`;
    const race = await f.run(
      session.id,
      steps(
        ["start_process", { command: quick, title: "quick" }],
        ["start_process", { command: SERVER, title: "slow" }],
        ["wait", { for: "any", seconds: 20 }],
      ),
    );
    assert.match(race, /^process-1: quick .* — exited \(exit 0\)\nLast output:\nquick done\n\nStill open: process-2\.$/);
    assert.equal(await f.run(session.id, say("stop", { id: "process-2" })), "Stopped.");
    assert.equal(await f.run(session.id, say("wait")), "Nothing this session started is still open.");
    assert.match(await f.run(session.id, say("wait", { ids: ["process-9"] })), /started nothing with that id/);
  } finally {
    await f.cleanup();
  }
});

test("a process runs in the background, outlives its idle session, and the person stopping it is a line, not a turn", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    const started = await f.run(
      session.id,
      steps(["start_process", { command: SERVER, title: "dev server" }], ["wait", { ids: ["process-1"], until: "ready on", seconds: 20 }]),
    );
    assert.match(started, /^process-1: dev server/);
    assert.match(started, /The output shows \/ready on\/i\./);
    assert.match(started, /ready on 5173/);
    const [process] = f.runtime.listProcesses(session.id);
    assert.equal(process!.state, "running");
    assert.equal(f.runtime.list().find((s) => s.id === session.id)?.processes, 1);

    // The session unloads; the process keeps running and its output keeps coming.
    await f.runtime.stop(session.id);
    const first = f.runtime.processOutput(session.id, process!.id, 0);
    await eventually(() => f.runtime.processOutput(session.id, process!.id, first.next).text.includes("tick"), 10_000);
    assert.equal(f.runtime.runningProcesses().processes[0]?.id, process!.id);

    // The agent reads only what it has not read yet (after the line describing the process).
    await f.runtime.ensure(session.id);
    const read = (await f.run(session.id, say("look", { id: "process-1" }))).split("\n").slice(1).join("\n");
    assert.ok(!read.includes("ready on 5173"), `earlier output is not repeated: ${read.slice(0, 300)}`);
    assert.match(read, /tick/);

    // The person stops it: the session gets a note of it, and its agent is not woken.
    f.runtime.stopProcess(session.id, process!.id);
    await eventually(() => f.runtime.listProcesses(session.id)[0]!.state === "stopped", 10_000);
    await eventually(() => f.runtime.items(session.id, {}).items.some((item) => item.customType === STATUS_ENTRY), 10_000);
    const line = f.runtime.items(session.id, {}).items.find((item) => item.customType === STATUS_ENTRY)!;
    assert.deepEqual(line.details, { process: process!.id, title: "dev server", how: "was stopped by you", ok: false });
    assert.equal(text(line), 'The person stopped the process "dev server" (process-1).');
    assert.ok(!f.runtime.items(session.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
  } finally {
    await f.cleanup();
  }
});

test("a failing command wakes its session with the exit code and its last output", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(session.id, say("start_process", { command: FAILING, title: "tests" })).completion;
    await eventually(() => f.runtime.items(session.id, {}).items.some((item) => item.customType === WOKEN_ENTRY), 15_000);
    const items = f.runtime.items(session.id, {}).items;
    const woken = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.equal((items[woken]!.details as { source: { kind: string; label: string } }).source.label, "tests · exited 1");
    assert.match(text(items[woken + 1]!), /^The process "tests" \(process-1\) exited 1\.\n\nLast output:\n1 failed, 212 passed/);
    const { card } = items[woken]!.details as { card: { title: string; how: string; start: number } };
    assert.deepEqual({ title: card.title, how: card.how }, { title: "tests", how: "exited 1" });
    assert.match(text(items[woken + 1]!).slice(card.start), /^1 failed, 212 passed/);
  } finally {
    await f.cleanup();
  }
});

test("a process raises a line of its output that matches raise_on; send changes or clears the pattern", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    const noisy = `node -e "setTimeout(() => console.log('error: disk full'), 1500); setInterval(() => console.log('tick'), 100)"`;
    await f.run(session.id, say("start_process", { command: noisy, title: "worker", raise_on: "error" }));
    assert.equal(f.runtime.listProcesses(session.id)[0]!.raiseOn, "error");
    await eventually(() => f.runtime.items(session.id, {}).items.some((item) => item.customType === WOKEN_ENTRY), 15_000);
    const items = f.runtime.items(session.id, {}).items;
    const woken = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.match(
      text(items[woken + 1]!),
      /^The process "worker" \(process-1\) printed a line matching error:\nerror: disk full\n\nLast output:\n/,
    );
    // It still runs: a raise is not an end.
    assert.equal(f.runtime.listProcesses(session.id)[0]!.state, "running");

    assert.equal(
      await f.run(session.id, say("send", { id: "process-1", raise_on: "fatal" })),
      "It raises when a line of its output matches /fatal/, at most once a minute.",
    );
    assert.equal(f.runtime.listProcesses(session.id)[0]!.raiseOn, "fatal");
    assert.equal(await f.run(session.id, say("send", { id: "process-1", raise_on: "" })), "It no longer raises on its output.");
    assert.equal(f.runtime.listProcesses(session.id)[0]!.raiseOn, undefined);
    assert.match(await f.run(session.id, say("send", { id: "process-1", text: "hello" })), /A process cannot be sent text/);
    await f.run(session.id, say("stop", { id: "process-1" }));
  } finally {
    await f.cleanup();
  }
});

test("processes end when PiSpark stops; after the restart their session is told", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    await f.run(session.id, say("start_process", { command: SERVER, title: "dev server" }));
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
    // Its handle means the same thing after the restart.
    assert.match(text(items[woken + 1]!), /^The process "dev server" \(process-1\) ended when PiSpark stopped\./);
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
    await f.run(session.id, steps(["start_process", { command: "npm run dev" }], ["wait", { until: "ready", seconds: 60 }]));
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
    assert.equal(await f.run(session.id, steps(["start_process", { command: SERVER }], ["stop", { id: "process-1" }])), "Stopped.");
    assert.equal(f.runtime.listProcesses(session.id)[0]!.state, "stopped");
  } finally {
    await f.cleanup();
  }
});

const GIT = String.raw`C:\Program Files\Git`;
test(
  "Windows: Stop finds Git's ps.exe from either Git Bash, and none for another bash",
  { skip: process.platform !== "win32" || !existsSync(join(GIT, "usr", "bin", "ps.exe")) },
  () => {
    const ps = join(GIT, "usr", "bin", "ps.exe");
    assert.equal(gitPs(join(GIT, "bin", "bash.exe")), ps);
    assert.equal(gitPs(join(GIT, "usr", "bin", "bash.exe")), ps);
    assert.equal(gitPs(String.raw`C:\Windows\System32\bash.exe`), undefined);
  },
);

test("an extension says a verb on the bus; a line it causes survives reload and restart without invoking a model", async () => {
  const f = await fixture();
  try {
    const name = "quiet";
    await writeAgent(
      f.home,
      name,
      { name: "Quiet" },
      {
        "extensions/quiet.mjs": `export default (pi) => {
        let started = false;
        pi.on("session_start", (event) => {
          if (started || event.reason !== "new") return;
          started = true;
          setTimeout(() => pi.events.emit("pispark:verb", {
            request: { verb: "start_process", command: ${JSON.stringify(SERVER)}, title: "Ticker" },
            reply: () => {}
          }), 50);
        });
      }`,
      },
    );
    const session = await f.runtime.create({ folder: f.folder, agent: name });
    await eventually(() => f.runtime.listProcesses(session.id)[0]?.state === "running", 10_000);
    f.runtime.stopProcess(session.id, f.runtime.listProcesses(session.id)[0]!.id);
    const statuses = (r: SessionRuntime) => r.items(session.id, {}).items.filter((item) => item.customType === STATUS_ENTRY);
    await eventually(() => statuses(f.runtime).length === 1, 20_000);
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

test("three process ends that waited for a working session reach it together: one message, one run", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    const quick = (title: string): ["start_process", object] => [
      "start_process",
      { command: `node -e "console.log('${title} ok')"`, title },
    ];
    const hold: ["start_process", object] = ["start_process", { command: `node -e "setTimeout(() => {}, 2500)"`, title: "hold" }];
    // The session stays in its turn, waiting for the slow one, while the three quick ones end.
    await f.run(session.id, steps(quick("lint"), quick("types"), quick("unit"), hold, ["wait", { ids: ["process-4"] }]));
    const woken = () => f.runtime.items(session.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY);
    await eventually(() => woken().length === 1, 15_000);
    await eventually(() => f.runtime.list().find((s) => s.id === session.id)?.status === "idle");
    await new Promise((done) => setTimeout(done, 400));
    // One delivery that names each of the three, and one run for it.
    assert.equal(woken().length, 1);
    const { together } = woken()[0]!.details as { together: { source: { label: string }; at: number }[] };
    assert.deepEqual(
      together.map((part) => part.source.label),
      ["lint · exited 0", "types · exited 0", "unit · exited 0"],
    );
    const items = f.runtime.items(session.id, {}).items;
    const at = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    const message = text(items[at + 1]!);
    assert.deepEqual(
      together.map((part) => message.slice(part.at).split("\n")[0]),
      ['The process "lint" (process-1) exited 0.', 'The process "types" (process-2) exited 0.', 'The process "unit" (process-3) exited 0.'],
    );
    assert.equal(items.slice(at).filter((item) => item.role === "assistant").length, 1);
  } finally {
    await f.cleanup();
  }
});

test("a process printing megabytes doesn't hold up the server, and its log is cut to the newest output with offsets that still add up", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    // About 6 MB in 64 KB writes as fast as it can, then one last line.
    const LOUD = `node -e "const b='x'.repeat(65535)+'\\n'; for(let i=0;i<96;i++) process.stdout.write(b); console.log('done')"`;
    let worst = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      worst = Math.max(worst, now - last - 5);
      last = now;
    }, 5);
    await f.run(session.id, say("start_process", { command: LOUD }));
    const [started] = f.runtime.listProcesses(session.id);
    await eventually(() => f.runtime.listProcesses(session.id)[0]!.state !== "running", 30_000);
    clearInterval(ticker);
    const [ended] = f.runtime.listProcesses(session.id);
    assert.equal(ended!.state, "exited");
    assert.equal(ended!.written, 96 * 65536 + "done\n".length);
    // Only the newest output is kept, and reading from the start says so.
    const all = f.runtime.processOutput(session.id, started!.id, 0);
    assert.equal(all.cut, true);
    const tail = f.runtime.processOutput(session.id, started!.id, ended!.written - 5);
    assert.deepEqual([tail.text, tail.next], ["done\n", ended!.written]);
    assert(worst < 100, `the event loop was held up for ${worst.toFixed(0)} ms`);
  } finally {
    await f.cleanup();
  }
});
