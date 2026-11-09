import { SafeLogger } from "../src/logger.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import {
  SessionRuntime,
  RuntimeError,
} from "../src/runtime/session-runtime.js";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { assertPiBoundary } from "../src/runtime/pi-boundary.js";
import { eventually } from "./fixtures/local-provider.js";
import { addControlledExtension, testHome } from "./fixtures/home.js";
import { chatItems, chatNotices, chatText, inFlight } from "./fixtures/chat.js";

const hasCode = (code: string) => (error: unknown) =>
  error instanceof RuntimeError && error.code === code;
const ambient = (root: string) => ({
  "value.txt": "",
  "AGENTS.md": "FORBIDDEN-AMBIENT-CONTEXT",
  ".pi/SYSTEM.md": "FORBIDDEN-AMBIENT-SYSTEM",
  ".pi/settings.json": JSON.stringify({
    packages: ["npm:must-not-install"],
    extensions: ["./extensions/sentinel.js"],
    defaultModel: "not-admitted",
  }),
  ".pi/extensions/sentinel.js": `import {writeFileSync} from 'node:fs'; export default ()=>writeFileSync(${JSON.stringify(join(root, "ambient-executed"))},'bad');`,
});
async function fixture(logger?: SafeLogger) {
  const h = await testHome("pispark-runtime-");
  const folders: Record<"a" | "b", string> = { a: "", b: "" };
  // Default grants nothing here; personas "a" and "b" each add read, an instruction and the controlled extension.
  await h.persona("default", { name: "Default" });
  for (const key of ["a", "b"] as const) {
    folders[key] = realpathSync.native(
      await h.folder(key, { ...ambient(h.root), "value.txt": `workspace-${key}` }),
    );
    await h.persona(
      key,
      { name: key.toUpperCase(), on: ["tool:read"] },
      {
        "instructions/1-system.md": `system-${key}`,
        "instructions/2-approved.md": `instructions-${key}`,
      },
    );
    await addControlledExtension(h.home, key);
  }
  const configuration = h.configuration;
  const runtime = new SessionRuntime(configuration, undefined, logger);
  const chatsDir = join(h.home, "chats");
  const transcript = async (id: string) =>
    join(
      chatsDir,
      id,
      (await readdir(join(chatsDir, id))).find((n) => n.endsWith(".jsonl"))!,
    );
  /** Write an extension file into persona `persona`. */
  const extension = async (persona: string, name: string, source: string) => {
    const dir = join(h.home, "personas", persona, "extensions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), source);
  };
  return {
    root: h.root,
    home: h.home,
    chatsDir,
    folders,
    provider: h.provider,
    configuration,
    runtime,
    history: h.history,
    transcript,
    extension,
    create: (key: "a" | "b", target = runtime) =>
      target.create({ folder: folders[key], persona: key }),
    cleanup: async () => {
      await runtime.shutdown();
      await h.remove();
    },
  };
}
/** An extension whose factory waits for `release()`, to hold a session in setup. */
function setupGate(f: Awaited<ReturnType<typeof fixture>>) {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const key = `pispark-gate:${f.root}`;
  (globalThis as unknown as Record<string, unknown>)[key] = pending;
  return {
    release,
    install: () =>
      f.extension(
        "a",
        "gate.mjs",
        `export default async () => { await globalThis[${JSON.stringify(key)}]; }`,
      ),
  };
}

test("SessionRuntime: real SDK concurrency, isolated resources/tools/history, partial snapshots, cancel and queue clearing", async () => {
  const f = await fixture();
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  try {
    const [a, b] = await Promise.all([
      f.create("a"),
      f.create("b"),
    ]);
    const observerA = f.runtime.observeLive(a.id);
    const observerB = f.runtime.observeLive(b.id);
    const runA = f.runtime.start(a.id, "first-a");
    const runB = f.runtime.start(b.id, "read:value.txt");
    await eventually(
      () => f.provider.active === 2 && inFlight(f.runtime, a.id).length > 0,
    );
    assert.equal(f.provider.peak, 2);
    assert.match(
      JSON.stringify(inFlight(f.runtime, a.id)),
      /partial-local/,
    );
    assert.equal((await observerA.events.next()).value?.sessionId, a.id);
    assert.equal((await observerB.events.next()).value?.sessionId, b.id);
    await f.runtime.queue(a.id, "must-not-run", "follow-up");
    await f.runtime.queue(a.id, "also-not-run", "steer");
    assert.equal(f.runtime.session(a.id).queue.followUp, 1);
    await f.runtime.cancel(a.id);
    assert.deepEqual(await runA.completion, { outcome: "cancelled" });
    assert.deepEqual(f.runtime.session(a.id).queue, {
      steering: 0,
      followUp: 0,
    });
    assert.equal(f.runtime.session(b.id).status, "running");
    assert.equal(f.provider.active, 1);
    f.provider.requests[1]!.release();
    await eventually(() => f.provider.requests.length === 3);
    f.provider.requests[2]!.release();
    assert.deepEqual(await runB.completion, { outcome: "completed" });
    // A slow observer keeps one latest invalidation, not every event.
    assert.equal((await observerB.events.next()).value?.sessionId, b.id);
    assert.match(
      chatText(f.runtime, b.id),
      /workspace-b/,
    );
    assert.doesNotMatch(
      chatText(f.runtime, a.id),
      /workspace-b|must-not-run|also-not-run/,
    );
    const requests = f.provider.requests.map((request) =>
      JSON.stringify(request.context),
    );
    assert.match(requests[0]!, /system-a/);
    assert.match(requests[0]!, /instructions-a/);
    assert.doesNotMatch(requests[0]!, /system-b|instructions-b|FORBIDDEN/);
    assert.match(requests[1]!, /system-b/);
    assert.doesNotMatch(requests[1]!, /instructions-a|FORBIDDEN/);
    assert.ok(
      f.provider.requests.every(
        (request) => request.apiKey === "pispark-local-keyless",
      ),
    );
    await assert.rejects(readFile(join(f.root, "ambient-executed")), {
      code: "ENOENT",
    });
    observerA.events.close();
    observerB.events.close();
    await Promise.all([f.runtime.stop(a.id), f.runtime.stop(b.id)]);
    for (const id of [a.id, b.id]) {
      const entries = await f.history(id);
      const start = entries.find(
        (entry) => entry.customType === "fixture-start",
      );
      assert.equal(start.data.starts, 1);
      assert.equal(start.data.hasUI, true);
      assert.equal(start.data.trusted, false);
      assert.equal(
        start.data.cwd,
        f.folders[id === a.id ? "a" : "b"],
      );
      assert.equal(
        entries.find((entry) => entry.customType === "fixture-run").data
          .busEvents,
        1,
      );
      assert.equal(
        entries.find((entry) => entry.customType === "fixture-stop").data.idle,
        true,
      );
    }
    const reopened = await f.runtime.open(b.id);
    assert.equal(reopened.id, b.id);
    assert.equal(reopened.interrupted, false);
    assert.match(chatText(f.runtime, b.id), /workspace-b/);
    assert.equal(
      f.provider.requests.length,
      3,
      "opening must never call a model or replay tools",
    );
    assert.equal(process.cwd(), originalCwd);
    assert.deepEqual({ ...process.env }, originalEnv);
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: empty metadata, one live owner, admission and detached observer bounds", async () => {
  const f = await fixture();
  const limited = new SessionRuntime({
    ...f.configuration,
    maxLiveSessions: 1,
  });
  const second = new SessionRuntime(f.configuration);
  try {
    const a = await f.create("a", limited);
    assert.equal(limited.list().length, 1);
    assert.equal(chatItems(limited, a.id).length, 0);
    await assert.rejects(
      f.create("b", limited),
      hasCode("limit"),
    );
    await assert.rejects(limited.open(a.id), hasCode("owned"));
    const observations = Array.from({ length: 16 }, () =>
      limited.observeLive(a.id),
    );
    assert.throws(() => limited.observeLive(a.id), hasCode("limit"));
    observations.forEach((observation) => observation.events.close());
    const detached = limited.observeLive(a.id);
    detached.events.close();
    f.provider.automatic = true;
    assert.deepEqual(
      await limited.start(a.id, "detached-still-runs").completion,
      { outcome: "completed" },
    );
    await limited.stop(a.id);
    assert.equal((await second.open(a.id)).interrupted, false);
    await second.stop(a.id);
    const empty = await f.create("b", limited);
    await limited.stop(empty.id);
    await second.open(empty.id);
    assert.equal(chatItems(second, empty.id).length, 0);
  } finally {
    await limited.shutdown();
    await second.shutdown();
    await f.cleanup();
  }
});

test("SessionRuntime: errors are safe, missing model/auth/resources rejected, invalid commands rejected", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.runtime.create({ folder: join(f.root, "missing") }),
      hasCode("folder"),
    );
    await assert.rejects(
      f.runtime.create({ folder: "relative/path" }),
      hasCode("invalid-input"),
    );
    await assert.rejects(
      f.runtime.create({ folder: f.folders.a, persona: "nobody" }),
      hasCode("persona"),
    );
    await assert.rejects(
      f.runtime.open("/absolute/native.jsonl"),
      hasCode("invalid-input"),
    );
    await assert.rejects(
      f.runtime.create({
        folder: f.folders.a,
        secret: "browser-supplied",
      } as never),
      hasCode("invalid-input"),
    );
    assert.throws(
      () => assertPiBoundary("0.85.0", () => {}),
      hasCode("sdk-version"),
    );
    assert.throws(
      () => assertPiBoundary("1.5.0", undefined),
      hasCode("sdk-version"),
    );
    const wrongModel = new SessionRuntime({
      ...f.configuration,
      fixedModel: { ...f.configuration.fixedModel!, id: "not-allowed" },
    });
    await assert.rejects(f.create("a", wrongModel), hasCode("configuration"));
    await wrongModel.shutdown();
    await f.extension("b", "broken.mjs", "export default (");
    await assert.rejects(f.create("b"), hasCode("extension"));
    const a = await f.create("a");
    assert.throws(() => f.runtime.start(a.id, ""), hasCode("invalid-input"));
    assert.throws(
      () => f.runtime.start(a.id, "x".repeat(65537)),
      hasCode("invalid-input"),
    );
    await assert.rejects(
      f.runtime.queue(a.id, "no active run", "steer"),
      hasCode("busy"),
    );
    f.provider.automatic = true;
    const run = f.runtime.start(a.id, "provider-error");
    assert.throws(() => f.runtime.start(a.id, "duplicate"), hasCode("busy"));
    assert.deepEqual(await run.completion, {
      outcome: "failed",
      error: "execution",
    });
    assert.equal(f.runtime.session(a.id).error, "execution");
    assert.doesNotMatch(
      JSON.stringify(f.runtime.session(a.id)),
      /pispark-local-keyless|Fixture error/,
    );
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: extension questions wait for an answer, cancel dismisses them, and ctx.ui state is shown", async () => {
  const f = await fixture();
  try {
    f.provider.automatic = true;
    const a = await f.create("a");
    const answers = async () =>
      (await f.history(a.id)).filter((e: { customType?: string }) => e.customType === "fixture-answer").map((e: { data: { value: unknown } }) => e.data.value);
    const ask = async (text: string, answer: string | boolean | null) => {
      const run = f.runtime.start(a.id, text);
      await eventually(() => f.runtime.session(a.id).extensions.dialogs.length === 1);
      const dialog = f.runtime.session(a.id).extensions.dialogs[0]!;
      // The chat says it waits for someone, in the list as well.
      assert.equal(f.runtime.session(a.id).waiting, true);
      assert.equal(f.runtime.list().find((chat) => chat.id === a.id)?.waiting, true);
      f.runtime.answer(a.id, dialog.id, answer);
      assert.equal((await run.completion).outcome, "completed");
      assert.equal(f.runtime.session(a.id).extensions.dialogs.length, 0);
      assert.equal(f.runtime.session(a.id).waiting, undefined);
      return dialog;
    };
    const confirm = await ask("ui-confirm", true);
    assert.deepEqual({ kind: confirm.kind, title: confirm.title }, { kind: "confirm", title: "Proceed?" });
    const select = await ask("ui-select", "two");
    assert.deepEqual(select.kind === "select" && select.options, ["one", "two"]);
    await ask("ui-input", "Ada");
    await ask("ui-select", null);
    // Only a listed option, a yes/no for confirm, or text for input is accepted.
    const pending = f.runtime.start(a.id, "ui-select");
    await eventually(() => f.runtime.session(a.id).extensions.dialogs.length === 1);
    const open = f.runtime.session(a.id).extensions.dialogs[0]!;
    assert.throws(() => f.runtime.answer(a.id, open.id, "three"), hasCode("invalid-input"));
    assert.throws(() => f.runtime.answer(a.id, "00000000-0000-4000-8000-000000000000", "one"), hasCode("not-found"));
    await f.runtime.cancel(a.id);
    assert.equal((await pending.completion).outcome, "cancelled");
    assert.equal(f.runtime.session(a.id).extensions.dialogs.length, 0);
    assert.equal((await f.runtime.start(a.id, "ui-timeout").completion).outcome, "completed");
    assert.equal((await f.runtime.start(a.id, "ui-custom").completion).outcome, "completed");
    assert.deepEqual(await answers(), [true, "two", "Ada", null, null, false, null]);
    // Notices, status, widgets and drafts are session state; a failing handler is a notice, not a failed chat.
    assert.equal((await f.runtime.start(a.id, "ui-show").completion).outcome, "completed");
    assert.equal((await f.runtime.start(a.id, "ui-fail").completion).outcome, "completed");
    const view = f.runtime.session(a.id).extensions;
    assert.deepEqual(view.statuses, [{ key: "fixture", line: [{ text: "ready", fg: "accent" }] }]);
    assert.deepEqual(view.widgets, [{ key: "fixture", placement: "below", lines: [[{ text: "widget line" }]] }]);
    assert.equal(view.draft?.text, "drafted by fixture");
    const expectedNotices = [
      // A line for each question a person answered or skipped; what they typed is not echoed.
      ["info", "Proceed? → yes"],
      ["info", "Pick one → two"],
      ["info", "Name → answered"],
      ["info", "Pick one → skipped"],
      ["warning", "Heads up"],
      ["error", "The controlled extension failed in before_agent_start: fixture failure"],
    ];
    assert.deepEqual(chatNotices(f.runtime, a.id).map((n) => [n.kind, n.lines[0]![0]!.text]), expectedNotices);
    assert.deepEqual(view.notices, [], "notices of an open chat are kept in its history");
    assert.equal(f.runtime.session(a.id).error, undefined);
    // Working indicator, thinking label, window title, one header and footer; Pi's session name is the chat title.
    assert.equal((await f.runtime.start(a.id, "ui-chrome").completion).outcome, "completed");
    const chrome = f.runtime.session(a.id);
    assert.deepEqual(chrome.extensions.working, {
      message: "Fixture working",
      frames: [[{ text: "*", fg: "accent" }], [{ text: "+" }]],
      intervalMs: 100,
    });
    assert.equal(chrome.extensions.thinkingLabel, "Pondering");
    assert.equal(chrome.extensions.title, "Fixture window");
    assert.deepEqual(chrome.extensions.header, [[{ text: "Fixture header", bold: true }]]);
    assert.match(chrome.extensions.footer![0]![0]!.text, /^branch:\S+ statuses:fixture$/);
    assert.equal(chrome.title, "Named by extension");
    assert.equal((await f.runtime.start(a.id, "ui-quiet").completion).outcome, "completed");
    const quiet = f.runtime.session(a.id).extensions;
    assert.equal(quiet.working?.hidden, true);
    assert.equal(quiet.header, undefined);
    await f.runtime.stop(a.id);
    // Reopened, the chat still has its notices where they happened.
    await f.runtime.open(a.id);
    assert.deepEqual(chatNotices(f.runtime, a.id).map((n) => [n.kind, n.lines[0]![0]!.text]), expectedNotices);
    await f.runtime.stop(a.id);
    f.provider.automatic = false;
    await stopAbortsBeforeShutdown(f);
  } finally {
    await f.cleanup();
  }
});

async function stopAbortsBeforeShutdown(f: Awaited<ReturnType<typeof fixture>>) {
  {
    const a = await f.create("a");
    const b = await f.create("b");
    const runA = f.runtime.start(a.id, "stop-me");
    const runB = f.runtime.start(b.id, "keep-going");
    await eventually(() => f.provider.active === 2);
    await f.runtime.stop(a.id);
    assert.equal((await runA.completion).outcome, "cancelled");
    assert.equal(f.runtime.session(b.id).status, "running");
    f.provider.requests.at(-1)!.release();
    assert.equal((await runB.completion).outcome, "completed");
    const entries = await f.history(a.id);
    assert.equal(entries.at(-1).customType, "fixture-stop");
    assert.equal(entries.at(-1).data.idle, true);
  }
}

test("SessionRuntime: interrupted marker retains native history without replay, missing/corrupt history fails closed", async () => {
  const f = await fixture();
  try {
    f.provider.automatic = true;
    const a = await f.create("a");
    await f.runtime.start(a.id, "saved").completion;
    await f.runtime.stop(a.id);
    const metadataPath = join(f.chatsDir, a.id, "chat.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    metadata.active = true;
    await writeFile(metadataPath, JSON.stringify(metadata));
    const requestCount = f.provider.requests.length;
    const reopened = await f.runtime.open(a.id);
    assert.equal(reopened.interrupted, true);
    assert.match(chatText(f.runtime, a.id), /saved/);
    assert.equal(f.provider.requests.length, requestCount);
    await f.runtime.stop(a.id);
    const native = await f.transcript(a.id);
    const original = await readFile(native, "utf8");
    await writeFile(native, `${original}{broken`);
    await assert.rejects(f.runtime.open(a.id), hasCode("storage"));
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: queue race with cancel clears delayed input, bounded queues and graceful shutdown", async () => {
  const f = await fixture();
  try {
    const a = await f.create("a");
    const run = f.runtime.start(a.id, "run");
    await eventually(() => f.provider.active === 1);
    for (let i = 0; i < 8; i++)
      await f.runtime.queue(a.id, `queued-${i}`, "follow-up");
    await assert.rejects(
      f.runtime.queue(a.id, "overflow", "steer"),
      hasCode("limit"),
    );
    await f.runtime.cancel(a.id);
    await run.completion;
    const next = f.runtime.start(a.id, "next");
    await eventually(() => f.provider.active === 1);
    const queue = f.runtime.queue(a.id, "slow-input", "follow-up");
    const rejected = assert.rejects(queue, hasCode("busy"));
    const cancel = f.runtime.cancel(a.id);
    await Promise.all([rejected, cancel]);
    await next.completion;
    assert.deepEqual(f.runtime.session(a.id).queue, {
      steering: 0,
      followUp: 0,
    });
    assert.equal(f.provider.requests.length, 2);
    await f.runtime.shutdown();
    await assert.rejects(
      f.create("a"),
      hasCode("closed"),
    );
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: killed process recovers finalized native tool history, no side effect replay, dead owner reclaimed", async () => {
  const f = await fixture();
  let child: ReturnType<typeof fork> | undefined;
  try {
    const effects = join(f.root, "effects.txt");
    await f.extension(
      "a",
      "side-effect.mjs",
      `import {appendFileSync} from 'node:fs'; export default (pi)=>{pi.on('tool_result',()=>{appendFileSync(${JSON.stringify(effects)},'effect\\n')})}`,
    );
    child = fork(
      fileURLToPath(new URL("./fixtures/crash-session.ts", import.meta.url)),
      [f.root],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let stderr = "";
    child.stderr!.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const ready = await Promise.race([
      once(child, "message").then(([message]) => message as { id: string }),
      once(child, "exit").then(() => {
        throw new Error(`Crash fixture exited too early: ${stderr}`);
      }),
    ]);
    assert.equal(await readFile(effects, "utf8"), "effect\n");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const restored = await f.runtime.open(ready.id);
    assert.equal(restored.interrupted, true);
    assert.equal(restored.status, "idle");
    assert.match(chatText(f.runtime, ready.id), /workspace-a/);
    assert.equal(inFlight(f.runtime, ready.id).length, 0);
    assert.equal(f.provider.requests.length, 0);
    assert.equal(await readFile(effects, "utf8"), "effect\n");
    assert.equal(
      (await f.history(ready.id)).filter(
        (entry) =>
          entry.type === "message" && entry.message.role === "toolResult",
      ).length,
      1,
    );
  } finally {
    child?.kill();
    await f.cleanup();
  }
});

test("SessionRuntime: isolated child ignores home/project resources; native command actions fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pispark-ambient-"));
  try {
    const home = join(root, "home");
    for (const dir of [join(home, ".pi", "agent"), join(root, "cwd", ".pi")]) {
      await mkdir(join(dir, "extensions"), { recursive: true });
      await mkdir(join(dir, "skills"), { recursive: true });
      await writeFile(
        join(dir, "extensions", "sentinel.js"),
        `import {writeFileSync} from 'node:fs'; export default ()=>writeFileSync(${JSON.stringify(join(root, "ambient-executed"))},'bad');`,
      );
      await writeFile(join(dir, "AGENTS.md"), "FORBIDDEN ambient instructions");
      await writeFile(join(dir, "SYSTEM.md"), "FORBIDDEN ambient system");
      await writeFile(
        join(dir, "skills", "SKILL.md"),
        "---\nname: forbidden\ndescription: FORBIDDEN skill\n---\nNo",
      );
      await writeFile(
        join(dir, "settings.json"),
        JSON.stringify({
          packages: ["npm:must-not-install"],
          defaultModel: "FORBIDDEN",
        }),
      );
    }
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("./fixtures/ambient-probe.ts", import.meta.url)),
        root,
      ],
      {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    const [code] = await once(child, "exit");
    assert.equal(code, 0, output);
    assert.match(output, /probes passed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SessionRuntime: storage write failures are not reported as success", async () => {
  const f = await fixture();
  try {
    const a = await f.create("a");
    const metadata = join(f.chatsDir, a.id, "chat.json");
    const original = await readFile(metadata, "utf8");
    await rm(metadata);
    await mkdir(metadata);
    assert.throws(
      () => f.runtime.start(a.id, "must-not-start"),
      hasCode("storage"),
    );
    assert.equal(f.provider.requests.length, 0);
    assert.equal(f.runtime.session(a.id).title, undefined);
    await rm(metadata, { recursive: true });
    await writeFile(metadata, original);
    const run = f.runtime.start(a.id, "write-fails-at-settlement");
    await eventually(() => f.provider.active === 1);
    const activeMetadata = await readFile(metadata, "utf8");
    await rm(metadata);
    await mkdir(metadata);
    f.provider.requests[0]!.release();
    assert.deepEqual(await run.completion, {
      outcome: "failed",
      error: "storage",
    });
    assert.equal(f.runtime.session(a.id).status, "error");
    await rm(metadata, { recursive: true });
    await writeFile(metadata, activeMetadata);
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: native history append failure reports failed run and keeps recovery honest", async () => {
  const f = await fixture();
  try {
    const a = await f.create("a");
    const run = f.runtime.start(a.id, "native-write-failure");
    await eventually(() => f.provider.active === 1);
    const native = await f.transcript(a.id);
    const saved = await readFile(native, "utf8");
    await rm(native);
    await mkdir(native);
    f.provider.requests[0]!.release();
    assert.equal((await run.completion).outcome, "failed");
    assert.equal(f.runtime.session(a.id).status, "error");
    await rm(native, { recursive: true });
    await writeFile(native, saved);
    await f.runtime.stop(a.id);
    const reopened = await f.runtime.open(a.id);
    assert.equal(reopened.interrupted, true);
    assert.equal(f.provider.requests.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: timeout retains ownership until noncooperative native shutdown actually finishes", async () => {
  const f = await fixture();
  await f.extension(
    "a",
    "slow-shutdown.mjs",
    `export default (pi)=>pi.on('session_shutdown',async()=>{await new Promise(r=>setTimeout(r,600))})`,
  );
  const slow = new SessionRuntime({
    ...f.configuration,
    operationTimeoutMs: 200,
  });
  try {
    const a = await f.create("a", slow);
    await assert.rejects(slow.stop(a.id), hasCode("timeout"));
    await assert.rejects(slow.open(a.id), hasCode("owned"));
    assert.equal(slow.session(a.id).status, "stopping");
    await eventually(() => slow.list()[0]?.status === "unloaded");
    await f.runtime.open(a.id);
  } finally {
    await slow.shutdown();
    await f.cleanup();
  }
});

test("SessionRuntime: shutdown drains pending initialization; missing tool files remain native error results", async () => {
  const f = await fixture();
  const gate = setupGate(f);
  const release = gate.release;
  const initializing = new SessionRuntime(f.configuration);
  try {
    await gate.install();
    const creation = f.create("a", initializing);
    const shutdown = initializing.shutdown();
    release();
    await creation;
    await shutdown;
    assert.equal(initializing.list()[0]?.status, "unloaded");
    f.provider.automatic = true;
    const a = await f.create("b");
    assert.equal(
      (await f.runtime.start(a.id, "read:missing.txt").completion).outcome,
      "completed",
    );
    assert.ok(
      chatItems(f.runtime, a.id).some((message) => message.role === "toolResult" && message.isError,
        ),
    );
  } finally {
    await initializing.shutdown();
    await f.cleanup();
  }
});

test("SessionRuntime: timed-out setup stays owned even if shutdown is requested again", async () => {
  const f = await fixture();
  const gate = setupGate(f);
  const release = gate.release;
  const blocked = new SessionRuntime({
    ...f.configuration,
    operationTimeoutMs: 40,
  });
  try {
    await gate.install();
    await assert.rejects(
      f.create("a", blocked),
      hasCode("timeout"),
    );
    assert.deepEqual(blocked.list(), []);
    const [id] = await readdir(f.chatsDir);
    assert(id);
    await assert.rejects(blocked.open(id), hasCode("owned"));
    await assert.rejects(blocked.shutdown(), hasCode("timeout"));
    release();
    await blocked.shutdown();
    assert.deepEqual(blocked.list(), []);
    assert.deepEqual(await readdir(f.chatsDir), []);
  } finally {
    release();
    await blocked.shutdown();
    await f.cleanup();
  }
});

test("SessionRuntime: cooperative run deadline fails truthfully and aborts the real SDK request", async () => {
  const f = await fixture();
  const bounded = new SessionRuntime({ ...f.configuration, runTimeoutMs: 40 });
  try {
    const a = await f.create("a", bounded);
    const run = bounded.start(a.id, "deadline");
    assert.deepEqual(await run.completion, {
      outcome: "failed",
      error: "timeout",
    });
    assert.equal(f.provider.requests[0]?.aborted, true);
    await eventually(() => bounded.session(a.id).status === "error");
  } finally {
    await bounded.shutdown();
    await f.cleanup();
  }
});

for (const action of ["cancel", "stop", "shutdown"] as const) {
  test(`SessionRuntime: ${action} during initial input preflight dispatches no provider or tool`, async () => {
    const f = await fixture();
    try {
      f.provider.automatic = true;
      const a = await f.create("a");
      const run = f.runtime.start(a.id, "slow-input");
      await (action === "shutdown"
        ? f.runtime.shutdown()
        : f.runtime[action](a.id));
      assert.equal((await run.completion).outcome, "cancelled");
      assert.equal(f.provider.requests.length, 0);
      if (action === "cancel") {
        assert.equal(
          chatItems(f.runtime, a.id).some((m) => m.role === "toolResult"),
          false,
        );
        assert.equal(f.runtime.session(a.id).status, "idle");
      } else assert.equal(f.runtime.list()[0]!.status, "unloaded");
    } finally {
      await f.cleanup();
    }
  });
}

for (const kind of ["steer", "follow-up"] as const) {
  test(`SessionRuntime: delayed ${kind} settles within originating run and cannot contaminate next run`, async () => {
    const f = await fixture();
    try {
      const a = await f.create("a");
      const run = f.runtime.start(a.id, "original");
      await eventually(() => f.provider.requests.length === 1);
      const queued = f.runtime.queue(a.id, "slow-input", kind);
      await assert.rejects(
        f.runtime.queue(a.id, "concurrent", kind),
        hasCode("busy"),
      );
      f.provider.automatic = true;
      f.provider.requests[0]!.release();
      assert.equal(await queued, "queued");
      await run.completion;
      assert.equal(f.provider.requests.length, 2);
      assert.match(
        JSON.stringify(f.provider.requests[1]!.context),
        /slow-input/,
      );
      f.provider.automatic = false;
      assert.deepEqual(f.runtime.session(a.id).queue, {
        steering: 0,
        followUp: 0,
      });
      const next = f.runtime.start(a.id, "unrelated");
      await eventually(() => f.provider.requests.length === 3);
      assert.deepEqual(f.runtime.session(a.id).queue, { steering: 0, followUp: 0 });
      await f.runtime.queue(a.id, "valid-next-input", kind);
      f.provider.automatic = true;
      f.provider.requests[2]!.release();
      assert.equal((await next.completion).outcome, "completed");
      assert.equal(f.provider.requests.length, 4);
      assert.doesNotMatch(
        JSON.stringify(f.provider.requests.map((r) => r.context)),
        /concurrent/,
      );
      assert.match(
        JSON.stringify(f.provider.requests.at(-1)!.context),
        /valid-next-input/,
      );
    } finally {
      await f.cleanup();
    }
  });
}

for (const action of ["cancel", "stop", "shutdown"] as const) {
  test(`SessionRuntime: ${action} during auth preflight retains ownership until settled and dispatches nothing`, async (t) => {
    const f = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    try {
      f.provider.automatic = true;
      const a = await f.create("a");
      const original = ModelRuntime.prototype.checkAuth;
      t.mock.method(ModelRuntime.prototype, "hasConfiguredAuth", () => false);
      t.mock.method(
        ModelRuntime.prototype,
        "checkAuth",
        async function (this: ModelRuntime, provider: string) {
          entered();
          await gate;
          return original.call(this, provider);
        },
      );
      const run = f.runtime.start(a.id, "read:value.txt");
      await entering;
      const stopping =
        action === "shutdown" ? f.runtime.shutdown() : f.runtime[action](a.id);
      assert.equal(
        f.runtime.session(a.id).status,
        action === "cancel" ? "cancelling" : "stopping",
      );
      await assert.rejects(f.runtime.open(a.id), hasCode("owned"));
      release();
      await stopping;
      assert.equal((await run.completion).outcome, "cancelled");
      assert.equal(f.provider.requests.length, 0);
      if (action === "cancel")
        assert.equal(
          chatItems(f.runtime, a.id).some((m) => m.role === "toolResult"),
          false,
        );
    } finally {
      release();
      t.mock.restoreAll();
      await f.cleanup();
    }
  });
}

async function gatedInput(f: Awaited<ReturnType<typeof fixture>>) {
  let release!: () => void;
  let entered!: () => void;
  let boundary!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const entering = new Promise<void>((r) => {
    entered = r;
  });
  const settling = new Promise<void>((r) => {
    boundary = r;
  });
  const key = `pispark-test:${f.root}`;
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[key] = {
    input: async () => {
      entered();
      await gate;
    },
    boundary,
  };
  await f.extension(
    "a",
    "gated-input.mjs",
    `export default pi => {
    pi.on('input', async event => {
      if (event.text === 'gated-input') {
        await globalThis[${JSON.stringify(key)}].input();
        return {action:'transform', text:'read:value.txt'};
      }
      if (event.text === 'handled-input') return {action:'handled'};
      return {action:'continue'};
    });
    pi.on('agent_before_settle', () => globalThis[${JSON.stringify(key)}].boundary());
  }`,
  );
  return {
    release,
    entering,
    settling,
    close: () => {
      release();
      delete globals[key];
    },
  };
}

for (const kind of ["steer", "follow-up"] as const) {
  test(`SessionRuntime: ${kind} native settle boundary waits for owned preparation without microtask admission gap`, async () => {
    const f = await fixture();
    const gate = await gatedInput(f);
    try {
      const a = await f.create("a");
      const run = f.runtime.start(a.id, "original");
      await eventually(() => f.provider.active === 1);
      assert.equal(
        await f.runtime.queue(a.id, "handled-input", kind),
        "handled",
      );
      const queued = f.runtime.queue(a.id, "gated-input", kind);
      await gate.entering;
      f.provider.requests[0]!.release();
      await gate.settling;
      assert.equal(f.runtime.session(a.id).status, "running");
      assert.throws(() => f.runtime.start(a.id, "unrelated"), hasCode("busy"));
      await assert.rejects(
        f.runtime.queue(a.id, "concurrent", kind),
        hasCode("busy"),
      );
      f.provider.automatic = true;
      gate.release();
      assert.equal(await queued, "queued");
      assert.equal((await run.completion).outcome, "completed");
      assert.equal(
        f.provider.requests.length,
        3,
        "original request, queued tool call, tool result continuation",
      );
      assert.deepEqual(f.runtime.session(a.id).queue, {
        steering: 0,
        followUp: 0,
      });
      await f.runtime.start(a.id, "next").completion;
      assert.equal(
        f.provider.requests.length,
        4,
        "no stranded input consumed by next run",
      );
    } finally {
      gate.close();
      await f.cleanup();
    }
  });
}

for (const phase of ["initial", "queued"] as const) {
  for (const action of ["cancel", "stop", "shutdown"] as const) {
    test(`SessionRuntime: stalled ${phase} input ${action} deadline retains ownership and prevents later dispatch`, async () => {
      const f = await fixture();
      const gate = await gatedInput(f);
      const runtime = new SessionRuntime({
        ...f.configuration,
        operationTimeoutMs: 200,
      });
      try {
        const a = await f.create("a", runtime);
        const run = runtime.start(
          a.id,
          phase === "initial" ? "gated-input" : "original",
        );
        let queue: Promise<unknown> | undefined;
        if (phase === "queued") {
          await eventually(() => f.provider.active === 1);
          queue = assert.rejects(
            runtime.queue(a.id, "gated-input", "follow-up"),
            (error) => hasCode("busy")(error) || hasCode("timeout")(error),
          );
        }
        await gate.entering;
        await assert.rejects(
          action === "shutdown" ? runtime.shutdown() : runtime[action](a.id),
          hasCode("timeout"),
        );
        await assert.rejects(runtime.open(a.id), hasCode("owned"));
        assert.equal(
          runtime.session(a.id).status,
          action === "cancel" ? "cancelling" : "stopping",
        );
        f.provider.automatic = true;
        gate.release();
        await queue;
        await run.completion;
        await (action === "cancel" ? runtime.cancel(a.id) : runtime.shutdown());
        assert.equal(f.provider.requests.length, phase === "initial" ? 0 : 1);
      } finally {
        gate.close();
        await runtime.shutdown();
        await f.cleanup();
      }
    });
  }
}

test("SessionRuntime: cancelled auth preflight cannot dispatch native history compaction; positive compaction and later runs remain native", async (t) => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const entering = new Promise<void>((r) => {
    entered = r;
  });
  try {
    f.provider.automatic = true;
    const a = await f.create("a");
    for (let i = 0; i < 2; i++)
      await f.runtime.start(a.id, "history".repeat(8000)).completion;
    await f.runtime.stop(a.id);
    const native = await f.transcript(a.id);
    const entries = (await readFile(native, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const last = entries.findLast(
      (entry) => entry.message?.role === "assistant",
    );
    last.message.usage.input = 12000;
    last.message.usage.totalTokens = 12001;
    await writeFile(
      native,
      entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
    f.configuration.fixedModel = {
      id: "deterministic",
      provider: () => {
        const provider = f.provider.provider();
        return {
          ...provider,
          getModels: () =>
            provider
              .getModels()
              .map((model) => ({ ...model, contextWindow: 8192 })),
        };
      },
    };
    await f.runtime.open(a.id);
    const original = ModelRuntime.prototype.checkAuth;
    t.mock.method(ModelRuntime.prototype, "hasConfiguredAuth", () => false);
    t.mock.method(
      ModelRuntime.prototype,
      "checkAuth",
      async function (this: ModelRuntime, provider: string) {
        entered();
        await gate;
        return original.call(this, provider);
      },
    );
    const before = f.provider.requests.length;
    const run = f.runtime.start(a.id, "cancel before compaction");
    await entering;
    const cancellation = f.runtime.cancel(a.id);
    release();
    await cancellation;
    assert.equal((await run.completion).outcome, "cancelled");
    assert.equal(
      f.provider.requests.length,
      before,
      "cancelled preflight must not dispatch the native compaction request",
    );
    t.mock.restoreAll();
    await f.runtime.stop(a.id);
    await f.runtime.open(a.id);
    const positiveBefore = f.provider.requests.length;
    assert.equal(
      (await f.runtime.start(a.id, "valid after cancellation").completion)
        .outcome,
      "completed",
    );
    assert(
      f.provider.requests.length > positiveBefore + 1,
      "uncancelled native compaction plus prompt dispatch",
    );
    assert(
      (await f.history(a.id)).some((entry) => entry.type === "compaction"),
    );
    const peer = await f.create("b");
    assert.equal(
      (await f.runtime.start(peer.id, "peer unaffected").completion).outcome,
      "completed",
    );
  } finally {
    release();
    t.mock.restoreAll();
    await f.cleanup();
  }
});

test("SessionRuntime: first accepted title survives cancellation, queueing and reopen without history backfill or logging", async () => {
  const lines: string[] = [];
  const logger = new SafeLogger({
    sink: async (line) => {
      lines.push(line);
    },
  });
  const f = await fixture(logger);
  try {
    const chat = await f.create("a");
    assert.equal(chat.title, undefined);
    assert.equal(chat.hasHistory, false);
    assert.throws(() => f.runtime.start(chat.id, ""), hasCode("invalid-input"));
    assert.equal(f.runtime.session(chat.id).title, undefined);
    const first = f.runtime.start(
      chat.id,
      ["PRIVATE-TITLE first\tinput", "not the title"].join("\n"),
    );
    await eventually(() => f.provider.active === 1);
    assert.equal(f.runtime.session(chat.id).title, "PRIVATE-TITLE first input");
    assert.equal(f.runtime.list()[0]!.title, "PRIVATE-TITLE first input");
    await f.runtime.queue(chat.id, "PRIVATE-QUEUED", "follow-up");
    await f.runtime.cancel(chat.id);
    assert.equal((await first.completion).outcome, "cancelled");
    const second = f.runtime.start(chat.id, "PRIVATE-SECOND");
    await eventually(() => f.provider.active === 1);
    await f.runtime.cancel(chat.id);
    await second.completion;
    await f.runtime.stop(chat.id);
    assert.equal(f.runtime.list()[0]!.title, "PRIVATE-TITLE first input");
    assert.equal(
      (await f.runtime.open(chat.id)).title,
      "PRIVATE-TITLE first input",
    );
    await f.runtime.stop(chat.id);
    const path = join(f.chatsDir, chat.id, "chat.json");
    const metadata = JSON.parse(await readFile(path, "utf8"));
    delete metadata.title;
    await writeFile(path, JSON.stringify(metadata));
    assert.equal((await f.runtime.open(chat.id)).title, undefined);
    const legacy = f.runtime.start(chat.id, "PRIVATE-LEGACY");
    await eventually(() => f.provider.active === 1);
    await f.runtime.cancel(chat.id);
    await legacy.completion;
    assert.equal(
      f.runtime.session(chat.id).title,
      undefined,
      "never backfill legacy history",
    );
  } finally {
    await f.cleanup();
    await logger.close();
  }
  assert.doesNotMatch(
    lines.join(""),
    /PRIVATE-|first input|not the title|title/i,
  );
});

test("SessionRuntime: accepted invisible-only input keeps its fallback title after pre-dispatch cancel and later input", async () => {
  const f = await fixture();
  try {
    const chat = await f.create("a");
    const first = f.runtime.start(chat.id, "\u202E\u200B");
    await f.runtime.cancel(chat.id);
    assert.equal((await first.completion).outcome, "cancelled");
    assert.equal(f.provider.requests.length, 0);
    // Native cancellation can persist the user and aborted response; it is not rollback.
    assert.equal(
      chatItems(f.runtime, chat.id).some((m) => m.role === "toolResult"),
      false,
    );
    assert.equal(f.runtime.session(chat.id).title, "New chat");
    const second = f.runtime.start(chat.id, "Visible input must not rename");
    await eventually(() => f.provider.active === 1);
    await f.runtime.cancel(chat.id);
    await second.completion;
    assert.equal(f.runtime.session(chat.id).title, "New chat");
    await f.runtime.stop(chat.id);
    assert.equal((await f.runtime.open(chat.id)).title, "New chat");
  } finally {
    await f.cleanup();
  }
});
