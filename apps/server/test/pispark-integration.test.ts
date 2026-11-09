import assert from "node:assert/strict";
import { test } from "node:test";
import { SafeLogger } from "../src/logger.js";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  readdir,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionRuntime,
  type RuntimeConfiguration,
} from "../src/runtime/session-runtime.js";
import { TITLE_TOOL, toolChatTitle } from "../src/runtime/chat-title.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";
import { chatItems, chatText } from "./fixtures/chat.js";

async function fixture() {
  const h = await testHome("pispark-integration-");
  const root = h.root;
  const cwd = await h.folder("cwd");
  const control = h.provider;
  control.automatic = true;
  // Default grants no tools, so the built-in title tool is the only one.
  await h.persona("default", { name: "Default" }, { "instructions/host.md": "PRESERVE-HOST-PROMPT" });
  const configuration: RuntimeConfiguration = h.configuration;
  const chats = join(h.home, "chats");
  const logs: string[] = [];
  const logger = new SafeLogger({
    sink: async (line) => {
      logs.push(line);
    },
  });
  const runtime = new SessionRuntime(configuration, undefined, logger);
  return {
    root,
    home: h.home,
    chats,
    cwd,
    persona: h.persona,
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
    await f.persona("fixture", { name: "Fixture" }, { "instructions/context.md": "PRESERVE-PERSONA-PROMPT" });
    const [a, b] = await Promise.all([
      f.runtime.create({ folder: f.cwd }),
      f.runtime.create({ folder: f.cwd, persona: "fixture" }),
    ]);
    const observer = f.runtime.observeLive(a.id);
    const other = f.runtime.observeLive(b.id);
    await Promise.all([
      f.runtime.start(a.id, command("  Native\nfixture  ")).completion,
      f.runtime.start(b.id, command("Persona fixture")).completion,
    ]);
    assert.equal(f.runtime.session(a.id).title, "Native");
    assert.equal(f.runtime.session(b.id).title, "Persona fixture");
    assert.equal((await observer.events.next()).value?.sessionId, a.id);
    assert.equal((await other.events.next()).value?.sessionId, b.id);
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
    await f.runtime.start(a.id, "later ordinary message").completion;
    assert.equal(f.runtime.session(a.id).title, "Native");
    const durable = JSON.parse(
      await readFile(join(f.chats, a.id, "chat.json"), "utf8"),
    );
    assert.equal(durable.title, "Native");
    await f.runtime.stop(a.id);
    await f.runtime.open(a.id);
    await f.runtime.start(a.id, command("Reopened fixture")).completion;
    assert.equal(f.runtime.session(a.id).title, "Reopened fixture");
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
    const a = await f.runtime.create({ folder: f.cwd });
    await f.runtime.start(a.id, "fallback purpose").completion;
    for (const title of ["", "\u0000\u200b", "a".repeat(4097), {}, undefined]) {
      await f.runtime.start(a.id, command(title)).completion;
      assert.equal(f.runtime.session(a.id).title, "fallback purpose");
      assert(
        chatItems(f.runtime, a.id).some((m) => m.role === "toolResult" && m.isError),
      );
    }
    await f.runtime.start(a.id, command(12)).completion;
    assert.equal(
      f.runtime.session(a.id).title,
      "12",
      "Native Pi normalizes numeric tool input to a schema string before execution",
    );
    await f.runtime.start(
      a.id,
      `title:${JSON.stringify({ title: "must not persist", sessionId: a.id })}`,
    ).completion;
    assert.equal(f.runtime.session(a.id).title, "12");
    assert.equal(Array.from(toolChatTitle("😀".repeat(90))).length, 80);
  } finally {
    await f.cleanup();
  }
});

test("PiSpark integration: reserved native tool collision fails before session execution", async () => {
  const f = await fixture();
  try {
    const extensions = join(f.home, "personas", "default", "extensions");
    await mkdir(extensions, { recursive: true });
    const extension = join(extensions, "collision.mjs");
    await writeFile(
      extension,
      `export default pi => pi.registerTool({name:'pispark_set_title', label:'Collision',description:'Collision',parameters:{type:'object',properties:{}},execute:async()=>({content:[],details:undefined})});`,
    );
    await assert.rejects(
      f.runtime.create({ folder: f.cwd }),
      { code: "extension" },
    );
    assert.equal(f.control.requests.length, 0);
    await rm(extension);
    await f.runtime.create({ folder: f.cwd });
  } finally {
    await f.cleanup();
  }
});

test("PiSpark integration: persist-first failure leaves current title and observation sequence intact", async () => {
  const f = await fixture();
  try {
    const a = await f.runtime.create({ folder: f.cwd });
    await f.runtime.start(a.id, "existing fixture").completion;
    // The host's synchronous closure is exercised directly to isolate metadata effects from native stream events.
    const internal = f.runtime as unknown as {
      live: Map<string, { metadata: unknown }>;
      setTitle: (host: unknown, title: string) => void;
    };
    const host = internal.live.get(a.id)!;
    const before = f.runtime.session(a.id);
    const path = join(f.chats, a.id, "chat.json");
    await rename(path, path + ".saved");
    await mkdir(path);
    try {
      assert.throws(
        () =>
          internal.setTitle(host, "not committed"),
        { code: "storage" },
      );
      assert.equal(f.runtime.session(a.id).title, before.title);
      assert.deepEqual(f.runtime.session(a.id), before);
    } finally {
      await rm(path, { recursive: true });
      await rename(path + ".saved", path);
    }
    await f.runtime.cancel(a.id);
    internal.setTitle(host, "Idle after cancellation");
    assert.equal(f.runtime.session(a.id).title, "Idle after cancellation");
    f.control.automatic = false;
    const run = f.runtime.start(a.id, "wait");
    await eventually(() => f.control.active === 1);
    const stopping = f.runtime.stop(a.id);
    assert.throws(
      () => internal.setTitle(host, "stopping"),
      { code: "closed" },
    );
    await stopping;
    await run.completion;
    await f.runtime.open(a.id);
    assert.throws(
      () => internal.setTitle(host, "old owner"),
      { code: "closed" },
    );
    assert.equal(f.runtime.session(a.id).title, "Idle after cancellation");
  } finally {
    await f.cleanup();
  }
});

test("PiSpark integration: a title that cannot be saved is said in the chat, and operational logs omit titles", async () => {
  const f = await fixture();
  const sensitive = "PRIVATE-TITLE-FIXTURE";
  try {
    const a = await f.runtime.create({ folder: f.cwd });
    await f.runtime.start(a.id, "prior name").completion;
    f.control.automatic = false;
    const count = f.control.requests.length;
    const run = f.runtime.start(a.id, command(sensitive));
    await eventually(() => f.control.requests.length === count + 1);
    const path = join(f.chats, a.id, "chat.json");
    await rename(path, path + ".saved");
    await mkdir(path);
    try {
      f.control.requests.at(-1)!.release();
      await eventually(() => f.control.requests.length === count + 2);
      // Pi named the session; saving it as the chat's title failed, and the chat says so.
      const notices = JSON.stringify(f.runtime.session(a.id).extensions.notices);
      assert.match(notices, /The chat title could not be saved/);
      assert(!notices.includes(sensitive));
      assert(!notices.includes(f.root));
      assert.equal(f.runtime.session(a.id).title, "prior name");
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
    assert.equal(f.runtime.session(a.id).title, "prior name");
    // Canonical native history normally includes tool arguments, unlike operational logging.
    assert(
      chatText(f.runtime, a.id).includes(sensitive),
    );
  } finally {
    await f.cleanup();
  }
  assert(!f.logs.join("").includes(sensitive));
});

test("PiSpark integration: legacy unmentioned tool activates on reopen; explicit host policy reactivates recorded removals", async () => {
  const f = await fixture();
  try {
    const a = await f.runtime.create({ folder: f.cwd });
    await f.runtime.start(a.id, "legacy fixture").completion;
    await f.runtime.stop(a.id);
    const path = join(
      f.chats,
      a.id,
      (await readdir(join(f.chats, a.id))).find((n) => n.endsWith(".jsonl"))!,
    );
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
    assert.equal(f.runtime.session(a.id).title, "Upgraded legacy fixture");
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
