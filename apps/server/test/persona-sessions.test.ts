import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionRuntime } from "../src/runtime/session-runtime.js";
import { RuntimeError } from "../src/runtime/errors.js";
import { DEFAULT_TOOLS } from "../src/personas/format.js";
import { TITLE_TOOL } from "../src/extensions/host-protocol.js";
import { eventually } from "./fixtures/local-provider.js";
import { localProviderSettings } from "./fixtures/provider-settings.js";
import { testHome } from "./fixtures/home.js";
import type { LocalRequest } from "./fixtures/local-provider.js";

const toolsOf = (request: LocalRequest) => [
  ...new Set(
    request.context.messages.flatMap((message) =>
      message.role === "system"
        ? (message.toolsAdded ?? []).map((tool) => tool.name)
        : [],
    ),
  ),
];
const systemText = (request: LocalRequest) =>
  JSON.stringify(request.context.messages.filter((m) => m.role === "system"));

async function fixture() {
  const h = await testHome("pispark-persona-sessions-");
  h.provider.automatic = true;
  const runtime = new SessionRuntime(h.configuration);
  const folder = await h.folder("work", { "value.txt": "WORK-FILE" });
  return {
    ...h,
    runtime,
    folder,
    cleanup: async () => {
      await runtime.shutdown();
      await h.remove();
    },
  };
}

test("a fresh data root needs no setup: Default gives every chat Pi's built-in tools", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    assert.equal(chat.persona.id, "default");
    await f.runtime.start(chat.id, "read:value.txt").completion;
    assert.deepEqual(
      toolsOf(f.provider.requests[0]!).sort(),
      [...DEFAULT_TOOLS, TITLE_TOOL].sort(),
    );
    assert.match(JSON.stringify(f.runtime.snapshot(chat.id).messages), /WORK-FILE/);
  } finally {
    await f.cleanup();
  }
});

test("a persona's instructions, skills, /commands, extensions and tool switches reach Pi", async () => {
  const f = await fixture();
  try {
    await f.persona(
      "dev",
      { name: "Dev", off: ["tool:bash", "tool:write"] },
      {
        "instructions/style.md": "DEV-INSTRUCTION",
        "skills/review/SKILL.md":
          "---\nname: review\ndescription: DEV-SKILL review checklist\n---\nSteps",
        "prompts/outline.md": "---\ndescription: Outline\n---\nOUTLINE-TEMPLATE about $1",
        "extensions/dev-tool.mjs": `export default pi => pi.registerTool({name:'dev_tool',label:'Dev',description:'Dev tool',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'ok'}],details:undefined})});`,
      },
    );
    const chat = await f.runtime.create({ folder: f.folder, persona: "dev" });
    assert.deepEqual(chat.persona, { id: "dev", name: "Dev", layered: false });
    await f.runtime.start(chat.id, "/outline pancakes").completion;
    const request = f.provider.requests[0]!;
    assert.match(systemText(request), /DEV-INSTRUCTION/);
    assert.match(systemText(request), /DEV-SKILL review checklist/);
    assert.match(JSON.stringify(request.context.messages.at(-1)), /OUTLINE-TEMPLATE about pancakes/);
    const tools = toolsOf(request);
    assert.ok(tools.includes("dev_tool"));
    assert.ok(tools.includes("read"));
    assert.ok(!tools.includes("bash") && !tools.includes("write"));
  } finally {
    await f.cleanup();
  }
});

test("persona edits flag open chats as changed; reload applies them from the same transcript", async () => {
  const f = await fixture();
  try {
    await f.persona("dev", { name: "Dev" }, { "instructions/a.md": "FIRST-VERSION" });
    const chat = await f.runtime.create({ folder: f.folder, persona: "dev" });
    const other = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(chat.id, "hello").completion;
    assert.equal(f.runtime.session(chat.id).personaChanged, undefined);
    const file = f.runtime.personas.readFile({ persona: "dev" }, "instructions/a.md");
    f.runtime.personas.writeFile({ persona: "dev" }, "instructions/a.md", file.revision, "SECOND-VERSION");
    assert.equal(f.runtime.session(chat.id).personaChanged, true);
    assert.equal(f.runtime.session(other.id).personaChanged, undefined, "Default chats are unaffected");
    f.provider.automatic = false;
    const run = f.runtime.start(chat.id, "busy");
    await eventually(() => f.provider.active === 1);
    await assert.rejects(f.runtime.reload(chat.id), (e) => e instanceof RuntimeError && e.code === "busy");
    f.provider.requests.at(-1)!.release();
    await run.completion;
    f.provider.automatic = true;
    const reloaded = await f.runtime.reload(chat.id);
    assert.equal(reloaded.personaChanged, undefined);
    await f.runtime.start(chat.id, "after reload").completion;
    const last = f.provider.requests.at(-1)!;
    assert.match(systemText(last), /SECOND-VERSION/);
    assert.match(JSON.stringify(last.context.messages), /hello/, "same transcript");
  } finally {
    await f.cleanup();
  }
});

test("an in-chat edit gives the chat its own layer; the persona itself is unchanged", async () => {
  const f = await fixture();
  try {
    await f.persona(
      "dev",
      { name: "Dev" },
      { "skills/review/SKILL.md": "---\nname: review\ndescription: REVIEW-SKILL\n---\n" },
    );
    const chat = await f.runtime.create({ folder: f.folder, persona: "dev" });
    f.runtime.personas.save({ chat: chat.id }, "", { base: ["dev"], off: ["skill:review"] });
    f.runtime.personas.writeFile({ chat: chat.id }, "instructions/extra.md", null, "CHAT-ONLY");
    assert.equal(f.runtime.session(chat.id).personaChanged, true);
    await f.runtime.reload(chat.id);
    await f.runtime.start(chat.id, "go").completion;
    const request = f.provider.requests.at(-1)!;
    assert.match(systemText(request), /CHAT-ONLY/);
    assert.doesNotMatch(systemText(request), /REVIEW-SKILL/);
    assert.deepEqual(f.runtime.list().find((c) => c.id === chat.id)!.persona, {
      id: "dev",
      name: "Dev",
      layered: true,
    });
    const fresh = await f.runtime.create({ folder: f.folder, persona: "dev" });
    await f.runtime.start(fresh.id, "fresh").completion;
    assert.match(systemText(f.provider.requests.at(-1)!), /REVIEW-SKILL/);
    assert.doesNotMatch(systemText(f.provider.requests.at(-1)!), /CHAT-ONLY/);
  } finally {
    await f.cleanup();
  }
});

test("model choice: Ask's model, else the persona's preferred model, else the default", async () => {
  const h = await testHome("pispark-persona-models-");
  const settings = await localProviderSettings(join(h.root, "providers"));
  settings.control.automatic = true;
  const provider = "pispark-local-test";
  await writeFile(settings.authPath, JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }));
  await settings.runtime.refresh({ allowNetwork: false });
  await settings.settings.setDefault({ provider, id: "deterministic" });
  const runtime = new SessionRuntime({ home: h.home }, settings.settings);
  try {
    const folder = await h.folder("work");
    await h.persona("fast", { name: "Fast", settings: { model: `${provider}/second` } });
    await h.persona("gone", { name: "Gone", settings: { model: "nowhere/none" } });
    assert.equal((await runtime.create({ folder })).model?.id, "deterministic");
    assert.equal((await runtime.create({ folder, persona: "fast" })).model?.id, "second");
    assert.equal(
      (await runtime.create({ folder, persona: "fast", model: { provider, id: "deterministic" } })).model?.id,
      "deterministic",
    );
    assert.equal((await runtime.create({ folder, persona: "gone" })).model?.id, "deterministic");
  } finally {
    await runtime.shutdown();
    await settings.settings.close();
    await h.remove();
  }
});
