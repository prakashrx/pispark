import { SessionStorage } from "../src/runtime/storage.js";
import { SafeLogger } from "../src/logger.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import {
  SessionRuntime,
  RuntimeError,
} from "../src/runtime/session-runtime.js";
import type {
  RuntimeConfiguration,
  SessionConfiguration,
} from "../src/runtime/session-runtime.js";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { assertPiBoundary } from "../src/runtime/pi-boundary.js";
import { LocalProviderControl, eventually } from "./fixtures/local-provider.js";

const extension = fileURLToPath(
  new URL("./fixtures/controlled-extension.mjs", import.meta.url),
);
const hasCode = (code: string) => (error: unknown) =>
  error instanceof RuntimeError && error.code === code;
async function fixture(logger?: SafeLogger) {
  const root = await mkdtemp(join(tmpdir(), "pispark-runtime-"));
  const provider = new LocalProviderControl();
  const storageDir = join(root, "state");
  const workspaces = { a: join(root, "a"), b: join(root, "b") };
  for (const [name, cwd] of Object.entries(workspaces)) {
    await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
    await writeFile(join(cwd, "value.txt"), `workspace-${name}`);
    await writeFile(join(cwd, "approved.md"), `instructions-${name}`);
    await writeFile(join(cwd, "AGENTS.md"), "FORBIDDEN-AMBIENT-CONTEXT");
    await writeFile(join(cwd, ".pi", "SYSTEM.md"), "FORBIDDEN-AMBIENT-SYSTEM");
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        packages: ["npm:must-not-install"],
        extensions: ["./extensions/sentinel.js"],
        defaultModel: "not-admitted",
      }),
    );
    await writeFile(
      join(cwd, ".pi", "extensions", "sentinel.js"),
      `import {writeFileSync} from 'node:fs'; export default ()=>writeFileSync(${JSON.stringify(join(root, "ambient-executed"))},'bad');`,
    );
  }
  const configuration: RuntimeConfiguration = {
    storageDir,
    workspaces,
    configurations: Object.fromEntries(
      Object.entries(workspaces).map(([key, cwd]) => [
        key,
        {
          modelId: "deterministic",
          provider: provider.provider,
          credential: { secretRef: "fixture-only" },
          systemPrompt: `system-${key}`,
          tools: ["read"],
          extensions: [extension],
          instructions: [join(cwd, "approved.md")],
        },
      ]),
    ),
    resolveSecret: async (ref) =>
      ref === "fixture-only" ? "local-test-not-a-real-secret" : undefined,
  };
  const runtime = new SessionRuntime(configuration, undefined, logger);
  const history = async (id: string) => {
    const dir = join(storageDir, id);
    const file = (await readdir(dir)).find((name) => name.endsWith(".jsonl"))!;
    return (await readFile(join(dir, file), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  };
  return {
    root,
    storageDir,
    provider,
    configuration,
    runtime,
    history,
    cleanup: async () => {
      await runtime.shutdown();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("SessionRuntime: real SDK concurrency, isolated resources/tools/history, partial snapshots, cancel and queue clearing", async () => {
  const f = await fixture();
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  try {
    const [a, b] = await Promise.all([
      f.runtime.create({ workspace: "a", configuration: "a" }),
      f.runtime.create({ workspace: "b", configuration: "b" }),
    ]);
    const observerA = f.runtime.observe(a.id);
    const observerB = f.runtime.observe(b.id);
    const runA = f.runtime.start(a.id, "first-a");
    const runB = f.runtime.start(b.id, "read:value.txt");
    await eventually(
      () => f.provider.active === 2 && !!f.runtime.snapshot(a.id).partial,
    );
    assert.equal(f.provider.peak, 2);
    assert.match(
      JSON.stringify(f.runtime.snapshot(a.id).partial),
      /partial-local/,
    );
    assert.equal((await observerA.events.next()).value?.sessionId, a.id);
    assert.equal((await observerB.events.next()).value?.sessionId, b.id);
    await f.runtime.queue(a.id, "must-not-run", "follow-up");
    await f.runtime.queue(a.id, "also-not-run", "steer");
    assert.equal(f.runtime.snapshot(a.id).queue.followUp.length, 1);
    await f.runtime.cancel(a.id);
    assert.deepEqual(await runA.completion, { outcome: "cancelled" });
    assert.deepEqual(f.runtime.snapshot(a.id).queue, {
      steering: [],
      followUp: [],
    });
    assert.equal(f.runtime.snapshot(b.id).status, "running");
    assert.equal(f.provider.active, 1);
    f.provider.requests[1]!.release();
    await eventually(() => f.provider.requests.length === 3);
    f.provider.requests[2]!.release();
    assert.deepEqual(await runB.completion, { outcome: "completed" });
    assert.equal(
      (await observerB.events.next()).value?.sequence,
      f.runtime.snapshot(b.id).sequence,
      "slow observation coalesces to latest snapshot boundary",
    );
    assert.match(
      JSON.stringify(f.runtime.snapshot(b.id).context),
      /workspace-b/,
    );
    assert.doesNotMatch(
      JSON.stringify(f.runtime.snapshot(a.id).context),
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
        (request) => request.apiKey === "local-test-not-a-real-secret",
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
      assert.equal(start.data.hasUI, false);
      assert.equal(start.data.trusted, false);
      assert.equal(
        start.data.cwd,
        await realpath(f.configuration.workspaces[id === a.id ? "a" : "b"]!),
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
    assert.match(JSON.stringify(reopened.context), /workspace-b/);
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
    const a = await limited.create({ workspace: "a", configuration: "a" });
    assert.equal(limited.list().length, 1);
    assert.equal(a.context.messages.length, 0);
    await assert.rejects(
      limited.create({ workspace: "b", configuration: "b" }),
      hasCode("limit"),
    );
    await assert.rejects(second.open(a.id), hasCode("owned"));
    const observations = Array.from({ length: 16 }, () =>
      limited.observe(a.id),
    );
    assert.throws(() => limited.observe(a.id), hasCode("limit"));
    observations.forEach((observation) => observation.events.close());
    const detached = limited.observe(a.id);
    detached.events.close();
    f.provider.automatic = true;
    assert.deepEqual(
      await limited.start(a.id, "detached-still-runs").completion,
      { outcome: "completed" },
    );
    await limited.stop(a.id);
    assert.equal((await second.open(a.id)).interrupted, false);
    await second.stop(a.id);
    const empty = await limited.create({ workspace: "b", configuration: "b" });
    await limited.stop(empty.id);
    assert.equal((await second.open(empty.id)).context.messages.length, 0);
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
      f.runtime.create({ workspace: "../outside", configuration: "a" }),
      hasCode("configuration"),
    );
    await assert.rejects(
      f.runtime.open("/absolute/native.jsonl"),
      hasCode("invalid-input"),
    );
    await assert.rejects(
      f.runtime.create({
        workspace: "a",
        configuration: "a",
        secret: "browser-supplied",
      } as never),
      hasCode("invalid-input"),
    );
    assert.throws(
      () => assertPiBoundary("0.85.0", () => {}),
      hasCode("sdk-version"),
    );
    assert.throws(
      () => assertPiBoundary("1.4.0", undefined),
      hasCode("sdk-version"),
    );
    for (const [override, code] of [
      [{ modelId: "not-allowed" }, "configuration"],
      [{ credential: { secretRef: "missing" } }, "credentials"],
      [{ extensions: [join(f.root, "missing.mjs")] }, "resources"],
    ] as [Partial<SessionConfiguration>, string][]) {
      const invalid = new SessionRuntime({
        ...f.configuration,
        configurations: {
          bad: { ...f.configuration.configurations.a!, ...override },
        },
      });
      await assert.rejects(
        invalid.create({ workspace: "a", configuration: "bad" }),
        hasCode(code),
      );
      await invalid.shutdown();
    }
    const a = await f.runtime.create({ workspace: "a", configuration: "a" });
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
    assert.equal(f.runtime.snapshot(a.id).error, "execution");
    assert.doesNotMatch(
      JSON.stringify(f.runtime.snapshot(a.id)),
      /local-test-not-a-real-secret|Fixture error/,
    );
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: headless dialogs fail visibly and stop aborts before native shutdown; another session unaffected", async () => {
  const f = await fixture();
  try {
    f.provider.automatic = true;
    for (const text of ["ui-confirm", "ui-select", "ui-input", "ui-custom"]) {
      const a = await f.runtime.create({ workspace: "a", configuration: "a" });
      assert.deepEqual(await f.runtime.start(a.id, text).completion, {
        outcome: "failed",
        error: "extension",
      });
      await f.runtime.stop(a.id);
    }
    f.provider.automatic = false;
    const a = await f.runtime.create({ workspace: "a", configuration: "a" });
    const b = await f.runtime.create({ workspace: "b", configuration: "b" });
    const runA = f.runtime.start(a.id, "stop-me");
    const runB = f.runtime.start(b.id, "keep-going");
    await eventually(() => f.provider.active === 2);
    await f.runtime.stop(a.id);
    assert.equal((await runA.completion).outcome, "cancelled");
    assert.equal(f.runtime.snapshot(b.id).status, "running");
    f.provider.requests.at(-1)!.release();
    assert.equal((await runB.completion).outcome, "completed");
    const entries = await f.history(a.id);
    assert.equal(entries.at(-1).customType, "fixture-stop");
    assert.equal(entries.at(-1).data.idle, true);
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: interrupted marker retains native history without replay, missing/corrupt history fails closed", async () => {
  const f = await fixture();
  try {
    f.provider.automatic = true;
    const a = await f.runtime.create({ workspace: "a", configuration: "a" });
    await f.runtime.start(a.id, "saved").completion;
    await f.runtime.stop(a.id);
    const metadataPath = join(f.storageDir, a.id, "host.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    metadata.active = true;
    await writeFile(metadataPath, JSON.stringify(metadata));
    const requestCount = f.provider.requests.length;
    const reopened = await f.runtime.open(a.id);
    assert.equal(reopened.interrupted, true);
    assert.match(JSON.stringify(reopened.context), /saved/);
    assert.equal(f.provider.requests.length, requestCount);
    await f.runtime.stop(a.id);
    const native = join(f.storageDir, a.id, metadata.nativeFile);
    const original = await readFile(native, "utf8");
    await writeFile(native, `${original}{broken`);
    await assert.rejects(f.runtime.open(a.id), hasCode("storage"));
    await rm(native);
    await assert.rejects(f.runtime.open(a.id), hasCode("storage"));
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: queue race with cancel clears delayed input, bounded queues and graceful shutdown", async () => {
  const f = await fixture();
  try {
    const a = await f.runtime.create({ workspace: "a", configuration: "a" });
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
    assert.deepEqual(f.runtime.snapshot(a.id).queue, {
      steering: [],
      followUp: [],
    });
    assert.equal(f.provider.requests.length, 2);
    await f.runtime.shutdown();
    await assert.rejects(
      f.runtime.create({ workspace: "a", configuration: "a" }),
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
    await writeFile(
      join(f.root, "side-effect.mjs"),
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
    assert.match(JSON.stringify(restored.context), /workspace-a/);
    assert.equal(restored.partial, undefined);
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
    const a = await f.runtime.create({ workspace: "a", configuration: "a" });
    const metadata = join(f.storageDir, a.id, "host.json");
    const original = await readFile(metadata, "utf8");
    await rm(metadata);
    await mkdir(metadata);
    assert.throws(
      () => f.runtime.start(a.id, "must-not-start"),
      hasCode("storage"),
    );
    assert.equal(f.provider.requests.length, 0);
    assert.equal(f.runtime.snapshot(a.id).title, undefined);
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
    assert.equal(f.runtime.snapshot(a.id).status, "error");
    await rm(metadata, { recursive: true });
    await writeFile(metadata, activeMetadata);
  } finally {
    await f.cleanup();
  }
});

test("SessionRuntime: native history append failure reports failed run and keeps recovery honest", async () => {
  const f = await fixture();
  try {
    const a = await f.runtime.create({ workspace: "a", configuration: "a" });
    const run = f.runtime.start(a.id, "native-write-failure");
    await eventually(() => f.provider.active === 1);
    const metadata = JSON.parse(
      await readFile(join(f.storageDir, a.id, "host.json"), "utf8"),
    );
    const native = join(f.storageDir, a.id, metadata.nativeFile);
    const saved = await readFile(native, "utf8");
    await rm(native);
    await mkdir(native);
    f.provider.requests[0]!.release();
    assert.equal((await run.completion).outcome, "failed");
    assert.equal(f.runtime.snapshot(a.id).status, "error");
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
  const slowExtension = join(f.root, "slow-shutdown.mjs");
  await writeFile(
    slowExtension,
    `export default (pi)=>pi.on('session_shutdown',async()=>{await new Promise(r=>setTimeout(r,600))})`,
  );
  const slow = new SessionRuntime({
    ...f.configuration,
    operationTimeoutMs: 200,
    configurations: {
      a: { ...f.configuration.configurations.a!, extensions: [slowExtension] },
    },
  });
  try {
    const a = await slow.create({ workspace: "a", configuration: "a" });
    await assert.rejects(slow.stop(a.id), hasCode("timeout"));
    await assert.rejects(f.runtime.open(a.id), hasCode("owned"));
    assert.equal(slow.snapshot(a.id).status, "stopping");
    await eventually(() => slow.list()[0]?.status === "unloaded");
    await f.runtime.open(a.id);
  } finally {
    await slow.shutdown();
    await f.cleanup();
  }
});

test("SessionRuntime: shutdown drains pending initialization; missing tool files remain native error results", async () => {
  const f = await fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const initializing = new SessionRuntime({
    ...f.configuration,
    resolveSecret: async () => {
      await pending;
      return "local-test-not-a-real-secret";
    },
  });
  try {
    const creation = initializing.create({
      workspace: "a",
      configuration: "a",
    });
    const shutdown = initializing.shutdown();
    release();
    await creation;
    await shutdown;
    assert.equal(initializing.list()[0]?.status, "unloaded");
    f.provider.automatic = true;
    const a = await f.runtime.create({ workspace: "a", configuration: "a" });
    assert.equal(
      (await f.runtime.start(a.id, "read:missing.txt").completion).outcome,
      "completed",
    );
    assert.ok(
      f.runtime
        .snapshot(a.id)
        .messages.some(
          (message) => message.role === "toolResult" && message.isError,
        ),
    );
  } finally {
    await initializing.shutdown();
    await f.cleanup();
  }
});

test("SessionRuntime: timed-out setup stays owned even if shutdown is requested again", async () => {
  const f = await fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocked = new SessionRuntime({
    ...f.configuration,
    operationTimeoutMs: 40,
    resolveSecret: async () => {
      await pending;
      return "explicit-only";
    },
  });
  try {
    await assert.rejects(
      blocked.create({ workspace: "a", configuration: "a" }),
      hasCode("timeout"),
    );
    assert.deepEqual(blocked.list(), []);
    const [id] = await readdir(f.storageDir);
    assert(id);
    assert.throws(() => new SessionStorage(f.storageDir).claim(id), hasCode("owned"));
    await assert.rejects(blocked.shutdown(), hasCode("timeout"));
    release();
    await blocked.shutdown();
    assert.deepEqual(blocked.list(), []);
    assert.deepEqual(await readdir(f.storageDir), []);
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
    const a = await bounded.create({ workspace: "a", configuration: "a" });
    const run = bounded.start(a.id, "deadline");
    assert.deepEqual(await run.completion, {
      outcome: "failed",
      error: "timeout",
    });
    assert.equal(f.provider.requests[0]?.aborted, true);
    await eventually(() => bounded.snapshot(a.id).status === "error");
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
      const a = await f.runtime.create({ workspace: "a", configuration: "a" });
      const run = f.runtime.start(a.id, "slow-input");
      await (action === "shutdown"
        ? f.runtime.shutdown()
        : f.runtime[action](a.id));
      assert.equal((await run.completion).outcome, "cancelled");
      assert.equal(f.provider.requests.length, 0);
      if (action === "cancel") {
        assert.equal(
          f.runtime
            .snapshot(a.id)
            .messages.some((m) => m.role === "toolResult"),
          false,
        );
        assert.equal(f.runtime.snapshot(a.id).status, "idle");
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
      const a = await f.runtime.create({ workspace: "a", configuration: "a" });
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
      assert.deepEqual(f.runtime.snapshot(a.id).queue, {
        steering: [],
        followUp: [],
      });
      const next = f.runtime.start(a.id, "unrelated");
      await eventually(() => f.provider.requests.length === 3);
      assert.doesNotMatch(
        JSON.stringify(f.runtime.snapshot(a.id).queue),
        /slow-input/,
      );
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
      const a = await f.runtime.create({ workspace: "a", configuration: "a" });
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
        f.runtime.snapshot(a.id).status,
        action === "cancel" ? "cancelling" : "stopping",
      );
      const other = new SessionRuntime(f.configuration);
      await assert.rejects(other.open(a.id), hasCode("owned"));
      await other.shutdown();
      release();
      await stopping;
      assert.equal((await run.completion).outcome, "cancelled");
      assert.equal(f.provider.requests.length, 0);
      if (action === "cancel")
        assert.equal(
          f.runtime
            .snapshot(a.id)
            .messages.some((m) => m.role === "toolResult"),
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
  const path = join(f.root, "gated-input.mjs");
  await writeFile(
    path,
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
  f.configuration.configurations.a!.extensions = [path];
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
      const a = await f.runtime.create({ workspace: "a", configuration: "a" });
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
      assert.equal(f.runtime.snapshot(a.id).status, "running");
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
      assert.deepEqual(f.runtime.snapshot(a.id).queue, {
        steering: [],
        followUp: [],
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
        const a = await runtime.create({ workspace: "a", configuration: "a" });
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
        await assert.rejects(f.runtime.open(a.id), hasCode("owned"));
        assert.equal(
          runtime.snapshot(a.id).status,
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
    const a = await f.runtime.create({ workspace: "a", configuration: "a" });
    for (let i = 0; i < 2; i++)
      await f.runtime.start(a.id, "history".repeat(8000)).completion;
    await f.runtime.stop(a.id);
    const metadata = JSON.parse(
      await readFile(join(f.storageDir, a.id, "host.json"), "utf8"),
    );
    const native = join(f.storageDir, a.id, metadata.nativeFile);
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
    f.configuration.configurations.a!.provider = () => {
      const provider = f.provider.provider();
      return {
        ...provider,
        getModels: () =>
          provider
            .getModels()
            .map((model) => ({ ...model, contextWindow: 8192 })),
      };
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
    const peer = await f.runtime.create({ workspace: "b", configuration: "b" });
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
    const chat = await f.runtime.create({ workspace: "a", configuration: "a" });
    assert.equal(chat.title, undefined);
    assert.equal(chat.hasHistory, false);
    assert.throws(() => f.runtime.start(chat.id, ""), hasCode("invalid-input"));
    assert.equal(f.runtime.snapshot(chat.id).title, undefined);
    const first = f.runtime.start(
      chat.id,
      ["PRIVATE-TITLE first\tinput", "not the title"].join("\n"),
    );
    await eventually(() => f.provider.active === 1);
    assert.equal(f.runtime.window(chat.id).title, "PRIVATE-TITLE first input");
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
    const path = join(f.storageDir, chat.id, "host.json");
    const metadata = JSON.parse(await readFile(path, "utf8"));
    delete metadata.title;
    await writeFile(path, JSON.stringify(metadata));
    assert.equal((await f.runtime.open(chat.id)).title, undefined);
    const legacy = f.runtime.start(chat.id, "PRIVATE-LEGACY");
    await eventually(() => f.provider.active === 1);
    await f.runtime.cancel(chat.id);
    await legacy.completion;
    assert.equal(
      f.runtime.snapshot(chat.id).title,
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
    const chat = await f.runtime.create({ workspace: "a", configuration: "a" });
    const first = f.runtime.start(chat.id, "\u202E\u200B");
    await f.runtime.cancel(chat.id);
    assert.equal((await first.completion).outcome, "cancelled");
    assert.equal(f.provider.requests.length, 0);
    // Native cancellation can persist the user and aborted response; it is not rollback.
    assert.equal(
      f.runtime.snapshot(chat.id).messages.some((m) => m.role === "toolResult"),
      false,
    );
    assert.equal(f.runtime.snapshot(chat.id).title, "New chat");
    const second = f.runtime.start(chat.id, "Visible input must not rename");
    await eventually(() => f.provider.active === 1);
    await f.runtime.cancel(chat.id);
    await second.completion;
    assert.equal(f.runtime.snapshot(chat.id).title, "New chat");
    await f.runtime.stop(chat.id);
    assert.equal((await f.runtime.open(chat.id)).title, "New chat");
  } finally {
    await f.cleanup();
  }
});
