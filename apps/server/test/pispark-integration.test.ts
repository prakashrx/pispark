import assert from "node:assert/strict";
import { test } from "node:test";
import { getEventListeners } from "node:events";
import { SafeLogger } from "../src/logger.js";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  SessionRuntime,
  type RuntimeConfiguration,
} from "../src/runtime/session-runtime.js";
import {
  bindHost,
  requestTitle,
  HOST_REQUEST,
  TITLE_TOOL,
} from "../src/extensions/host-protocol.js";
import { toolChatTitle } from "../src/runtime/chat-title.js";
import { LocalProviderControl, eventually } from "./fixtures/local-provider.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pispark-integration-"));
  const cwd = join(root, "cwd");
  await mkdir(cwd);
  const control = new LocalProviderControl();
  control.automatic = true;
  const configuration: RuntimeConfiguration = {
    storageDir: join(root, "sessions"),
    workspaces: { work: cwd },
    configurations: {
      quiet: {
        credential: { local: true },
        provider: control.provider,
        modelId: "deterministic",
        tools: [],
        systemPrompt: "PRESERVE-HOST-PROMPT",
      },
    },
    resolveSecret: async () => undefined,
  };
  const logs: string[] = [];
  const logger = new SafeLogger({
    sink: async (line) => {
      logs.push(line);
    },
  });
  const runtime = new SessionRuntime(configuration, undefined, logger);
  return {
    root,
    configuration,
    control,
    runtime,
    logs,
    logger,
    cleanup: async () => {
      await runtime.shutdown();
      await logger.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const command = (title: unknown) => `title:${JSON.stringify({ title })}`;

test("PiSpark integration: real native title-only calls, persona/no-persona isolation, observers, persistence and reopen", async () => {
  const f = await fixture();
  try {
    const persona = await f.runtime.personas.create({
      schemaVersion: 1,
      name: "Fixture",
      instructions: [{ id: "context", text: "PRESERVE-PERSONA-PROMPT" }],
    });
    const [a, b] = await Promise.all([
      f.runtime.create({ workspace: "work", configuration: "quiet" }),
      f.runtime.create({
        workspace: "work",
        configuration: "quiet",
        persona: { ...persona.ref, revision: persona.revision },
      }),
    ]);
    const observer = f.runtime.observe(a.id);
    const other = f.runtime.observe(b.id);
    await Promise.all([
      f.runtime.start(a.id, command("  Native\nfixture  ")).completion,
      f.runtime.start(b.id, command("Persona fixture")).completion,
    ]);
    assert.equal(f.runtime.snapshot(a.id).title, "Native");
    assert.equal(f.runtime.snapshot(b.id).title, "Persona fixture");
    assert.equal((await observer.events.next()).value?.sessionId, a.id);
    assert.equal((await other.events.next()).value?.sessionId, b.id);
    assert(f.runtime.snapshot(a.id).sequence > observer.snapshot.sequence);
    for (const request of f.control.requests)
      assert.deepEqual(
        request.context.messages.flatMap((message) =>
          message.role === "system"
            ? (message.toolsAdded ?? []).map((tool) => tool.name)
            : [],
        ),
        [TITLE_TOOL],
      );
    const prompts = JSON.stringify(
      f.control.requests.map((request) =>
        request.context.messages.filter((m) => m.role === "system"),
      ),
    );
    assert(prompts.includes("PRESERVE-HOST-PROMPT"));
    assert(prompts.includes("PRESERVE-PERSONA-PROMPT"));
    assert(prompts.includes("when its purpose is clear"));
    assert.deepEqual(f.configuration.configurations.quiet!.tools, []);
    await f.runtime.start(a.id, "later ordinary message").completion;
    assert.equal(f.runtime.snapshot(a.id).title, "Native");
    const durable = JSON.parse(
      await readFile(
        join(f.configuration.storageDir, a.id, "host.json"),
        "utf8",
      ),
    );
    assert.equal(durable.title, "Native");
    await f.runtime.stop(a.id);
    await f.runtime.open(a.id);
    await f.runtime.start(a.id, command("Reopened fixture")).completion;
    assert.equal(f.runtime.snapshot(a.id).title, "Reopened fixture");
    assert.deepEqual(
      f.control.requests
        .at(-1)!
        .context.messages.flatMap((message) =>
          message.role === "system"
            ? (message.toolsAdded ?? []).map((tool) => tool.name)
            : [],
        ),
      [TITLE_TOOL],
    );
    observer.events.close();
    other.events.close();
  } finally {
    await f.cleanup();
  }
});

test("PiSpark integration: invalid model arguments do not replace fallback; no target-session parameter", async () => {
  const f = await fixture();
  try {
    const a = await f.runtime.create({
      workspace: "work",
      configuration: "quiet",
    });
    await f.runtime.start(a.id, "fallback purpose").completion;
    for (const title of ["", "\u0000\u200b", "a".repeat(4097), {}, undefined]) {
      await f.runtime.start(a.id, command(title)).completion;
      assert.equal(f.runtime.snapshot(a.id).title, "fallback purpose");
      assert(
        f.runtime
          .snapshot(a.id)
          .messages.some((m) => m.role === "toolResult" && m.isError),
      );
    }
    await f.runtime.start(a.id, command(12)).completion;
    assert.equal(
      f.runtime.snapshot(a.id).title,
      "12",
      "Native Pi normalizes numeric tool input to a schema string before execution",
    );
    await f.runtime.start(
      a.id,
      `title:${JSON.stringify({ title: "must not persist", sessionId: a.id })}`,
    ).completion;
    assert.equal(f.runtime.snapshot(a.id).title, "12");
    assert.equal(Array.from(toolChatTitle("😀".repeat(90))).length, 80);
  } finally {
    await f.cleanup();
  }
});

test("PiSpark integration: reserved native tool collision fails before session execution", async () => {
  const f = await fixture();
  try {
    const extension = join(f.root, "collision.mjs");
    await writeFile(
      extension,
      `export default pi => pi.registerTool({name:'pispark_set_title', label:'Collision',description:'Collision',parameters:{type:'object',properties:{}},execute:async()=>({content:[],details:undefined})});`,
    );
    f.configuration.configurations.quiet!.extensions = [extension];
    await assert.rejects(
      f.runtime.create({ workspace: "work", configuration: "quiet" }),
      { code: "resources" },
    );
    assert.equal(f.control.requests.length, 0);
    f.configuration.configurations.quiet!.extensions = [];
    await f.runtime.create({ workspace: "work", configuration: "quiet" });
  } finally {
    await f.cleanup();
  }
});

test("PiSpark integration: persist-first failure leaves current title and observation sequence intact", async () => {
  const f = await fixture();
  try {
    const a = await f.runtime.create({
      workspace: "work",
      configuration: "quiet",
    });
    await f.runtime.start(a.id, "existing fixture").completion;
    // The host's synchronous closure is exercised directly to isolate metadata effects from native stream events.
    const internal = f.runtime as unknown as {
      live: Map<string, { metadata: unknown }>;
      setTitle: (host: unknown, title: string, signal: AbortSignal) => void;
    };
    const host = internal.live.get(a.id)!;
    const before = f.runtime.snapshot(a.id);
    const path = join(f.configuration.storageDir, a.id, "host.json");
    await rename(path, path + ".saved");
    await mkdir(path);
    try {
      assert.throws(
        () =>
          internal.setTitle(
            host,
            "not committed",
            new AbortController().signal,
          ),
        { code: "storage" },
      );
      assert.equal(f.runtime.snapshot(a.id).title, before.title);
      assert.equal(f.runtime.snapshot(a.id).sequence, before.sequence);
    } finally {
      await rm(path, { recursive: true });
      await rename(path + ".saved", path);
    }
    await f.runtime.cancel(a.id);
    internal.setTitle(
      host,
      "Idle after cancellation",
      new AbortController().signal,
    );
    assert.equal(f.runtime.snapshot(a.id).title, "Idle after cancellation");
    const aborted = new AbortController();
    aborted.abort();
    assert.throws(() => internal.setTitle(host, "aborted", aborted.signal), {
      code: "closed",
    });
    f.control.automatic = false;
    const run = f.runtime.start(a.id, "wait");
    await eventually(() => f.control.active === 1);
    const stopping = f.runtime.stop(a.id);
    assert.throws(
      () => internal.setTitle(host, "stopping", new AbortController().signal),
      { code: "closed" },
    );
    await stopping;
    await run.completion;
    await f.runtime.open(a.id);
    assert.throws(
      () => internal.setTitle(host, "old owner", new AbortController().signal),
      { code: "closed" },
    );
    assert.equal(f.runtime.snapshot(a.id).title, "Idle after cancellation");
  } finally {
    await f.cleanup();
  }
});

test("host protocol: acknowledged errors, abort, callback safety, disposal and bounded missing-host wait", async () => {
  const bus = createEventBus();
  let calls = 0;
  const close = bindHost(bus, () => {
    calls++;
  });
  const successfulSignal = new AbortController();
  await requestTitle(bus, "fixture", successfulSignal.signal);
  assert.equal(getEventListeners(successfulSignal.signal, "abort").length, 0);
  assert.equal(calls, 1);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(requestTitle(bus, "fixture", abort.signal), /aborted/);
  assert.equal(calls, 1);
  let invalid: unknown;
  bus.emit(HOST_REQUEST, {
    operation: "chat.set_title",
    title: 12,
    signal: new AbortController().signal,
    settle: (reply: unknown) => (invalid = reply),
  });
  assert.deepEqual(invalid, { ok: false, error: "invalid-input" });
  assert.equal(calls, 1);
  bus.emit(HOST_REQUEST, {
    operation: "anything",
    settle: (reply: unknown) => (invalid = reply),
  });
  assert.deepEqual(invalid, { ok: false, error: "invalid-input" });
  bus.emit(HOST_REQUEST, {
    operation: "chat.set_title",
    title: "fixture",
    signal: new AbortController().signal,
    settle: () => {
      throw Error("private cause");
    },
  });
  close();
  close();
  const controller = new AbortController();
  const missing = requestTitle(bus, "fixture", controller.signal);
  controller.abort();
  await assert.rejects(missing, /aborted/);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const start = Date.now();
  await assert.rejects(requestTitle(bus, "fixture"), /unavailable/);
  assert(Date.now() - start >= 4900);
  const failing = bindHost(bus, () => {
    throw Object.assign(new Error("private title and path"), {
      code: "storage",
    });
  });
  await assert.rejects(requestTitle(bus, "fixture"), {
    message: "PiSpark title update: storage",
  });
  failing();
});

test("PiSpark integration: actual native tool storage failure is sanitized and operational logs omit titles", async () => {
  const f = await fixture();
  const sensitive = "PRIVATE-TITLE-FIXTURE";
  try {
    const a = await f.runtime.create({
      workspace: "work",
      configuration: "quiet",
    });
    await f.runtime.start(a.id, "prior name").completion;
    f.control.automatic = false;
    const count = f.control.requests.length;
    const run = f.runtime.start(a.id, command(sensitive));
    await eventually(() => f.control.requests.length === count + 1);
    const path = join(f.configuration.storageDir, a.id, "host.json");
    await rename(path, path + ".saved");
    await mkdir(path);
    try {
      f.control.requests.at(-1)!.release();
      await eventually(() => f.control.requests.length === count + 2);
      const result = f.runtime
        .snapshot(a.id)
        .messages.findLast((m) => m.role === "toolResult");
      assert(result?.role === "toolResult" && result.isError);
      assert(
        JSON.stringify(result.content).includes(
          "PiSpark title update: storage",
        ),
      );
      assert(!JSON.stringify(result.content).includes(sensitive));
      assert(!JSON.stringify(result.content).includes(f.root));
      assert.equal(f.runtime.snapshot(a.id).title, "prior name");
    } finally {
      await rm(path, { recursive: true });
      await rename(path + ".saved", path);
    }
    f.control.requests.at(-1)!.release();
    assert.equal(
      (await run.completion).outcome,
      "completed",
      "A failed native tool result does not itself make the host run fail",
    );
    assert.equal(f.runtime.snapshot(a.id).title, "prior name");
    // Canonical native history normally includes tool arguments, unlike operational logging.
    assert(
      JSON.stringify(f.runtime.snapshot(a.id).messages).includes(sensitive),
    );
  } finally {
    await f.cleanup();
  }
  assert(!f.logs.join("").includes(sensitive));
});

test("PiSpark integration: legacy unmentioned tool activates on reopen; explicit host policy reactivates recorded removals", async () => {
  const f = await fixture();
  try {
    const a = await f.runtime.create({
      workspace: "work",
      configuration: "quiet",
    });
    await f.runtime.start(a.id, "legacy fixture").completion;
    await f.runtime.stop(a.id);
    const metadata = JSON.parse(
      await readFile(
        join(f.configuration.storageDir, a.id, "host.json"),
        "utf8",
      ),
    );
    const path = join(f.configuration.storageDir, a.id, metadata.nativeFile);
    const original = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (const entry of original) {
      if (entry.type === "message" && entry.message.role === "system") {
        entry.message.toolsAdded = (entry.message.toolsAdded ?? []).filter(
          (tool: { name: string }) => tool.name !== TITLE_TOOL,
        );
        // Model a pre-integration history without host guidance.
        if (entry.message.sections)
          for (const key of Object.keys(entry.message.sections))
            if (
              String(entry.message.sections[key]).includes(
                "PiSpark hosts this chat",
              )
            )
              delete entry.message.sections[key];
      }
    }
    await writeFile(
      path,
      original.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
    await f.runtime.open(a.id);
    await f.runtime.start(a.id, command("Upgraded legacy fixture")).completion;
    assert.equal(f.runtime.snapshot(a.id).title, "Upgraded legacy fixture");
    await f.runtime.stop(a.id);
    const removed = structuredClone(original);
    const system = removed.find(
      (entry) => entry.type === "message" && entry.message.role === "system",
    );
    assert(system);
    system.message.toolsRemoved = [{ name: TITLE_TOOL }];
    await writeFile(
      path,
      removed.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
    await f.runtime.open(a.id);
    await f.runtime.start(a.id, "normal removed-loadout fixture").completion;
    const latest = f.control.requests
      .at(-1)!
      .context.messages.filter((m) => m.role === "system");
    assert(JSON.stringify(latest).includes("when its purpose is clear"));
    assert.deepEqual(
      [
        ...new Set(
          latest.flatMap((m) => m.toolsAdded?.map((tool) => tool.name) ?? []),
        ),
      ],
      [TITLE_TOOL],
    );
  } finally {
    await f.cleanup();
  }
});
