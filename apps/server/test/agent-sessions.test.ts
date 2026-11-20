import { viewAgent } from "../src/core/agents/resolve.js";
import { BUILT_IN_SKILLS } from "../src/core/runtime/configuration.js";
import { PROCESS_TOOL } from "../src/core/runtime/process-tool.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { RuntimeError } from "../src/core/runtime/errors.js";
import { DEFAULT_TOOLS } from "../src/core/agents/format.js";
import { TITLE_TOOL } from "../src/core/runtime/session-title.js";
import { SCHEDULE_TOOL } from "../src/core/runtime/schedule-tool.js";
import { SESSION_TOOL } from "../src/core/runtime/session-tool.js";
import { eventually } from "./fixtures/local-provider.js";
import { localProviderSettings } from "./fixtures/provider-settings.js";
import { testHome } from "./fixtures/home.js";
import type { LocalRequest } from "./fixtures/local-provider.js";
import { sessionText } from "./fixtures/session.js";

const toolsOf = (request: LocalRequest) => [
  ...new Set(
    request.context.messages.flatMap((message) =>
      message.role === "system"
        ? (message.toolsAdded ?? []).map((tool) => tool.name)
        : [],
    ),
  ),
];
/** The tools the model has at this request: each system message's additions and removals, in order. */
const currentTools = (request: LocalRequest) => {
  const on = new Set<string>();
  for (const message of request.context.messages)
    if (message.role === "system") {
      for (const tool of message.toolsRemoved ?? []) on.delete(tool.name);
      for (const tool of message.toolsAdded ?? []) on.add(tool.name);
    }
  return [...on];
};
const systemText = (request: LocalRequest) =>
  JSON.stringify(request.context.messages.filter((m) => m.role === "system"));

async function fixture() {
  const h = await testHome("pispark-agent-sessions-");
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

test("a fresh data root needs no setup: Default gives every session Pi's built-in tools", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    assert.equal(session.agent.id, "default");
    await f.runtime.start(session.id, "read:value.txt").completion;
    assert.deepEqual(
      toolsOf(f.provider.requests[0]!).sort(),
      [...DEFAULT_TOOLS, TITLE_TOOL, SCHEDULE_TOOL, SESSION_TOOL, PROCESS_TOOL].sort(),
    );
    assert.match(sessionText(f.runtime, session.id), /WORK-FILE/);
  } finally {
    await f.cleanup();
  }
});

test("an agent's instructions, skills, /commands, extensions and tool switches reach Pi", async () => {
  const f = await fixture();
  try {
    await f.agent(
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
    const session = await f.runtime.create({ folder: f.folder, agent: "dev" });
    assert.deepEqual(session.agent, { id: "dev", name: "Dev", layered: false });
    await f.runtime.start(session.id, "/outline pancakes").completion;
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

test("a tool an extension registers once the session runs reaches the model; the agent's switches still win on reopen", async () => {
  const f = await fixture();
  try {
    const late = `export default pi => pi.on("session_start", () => pi.registerTool({name:'late_tool',label:'Late',description:'Registered at session start',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'ok'}],details:undefined})}));`;
    await f.agent("late", { name: "Late", off: ["tool:bash"] }, { "extensions/late.mjs": late });
    const session = await f.runtime.create({ folder: f.folder, agent: "late" });
    await f.runtime.start(session.id, "first").completion;
    let tools = currentTools(f.provider.requests.at(-1)!);
    assert.ok(tools.includes("late_tool"), "registered after startup, still offered");
    assert.ok(tools.includes("read") && !tools.includes("bash"));

    // The transcript now records read on and bash off; the agent flips both, and the agent wins.
    await f.agent("late", { name: "Late", off: ["tool:read"] }, { "extensions/late.mjs": late });
    await f.runtime.reload(session.id);
    await f.runtime.start(session.id, "second").completion;
    tools = currentTools(f.provider.requests.at(-1)!);
    assert.ok(!tools.includes("read"), "read is off");
    assert.ok(tools.includes("bash"), "bash is back on");
    assert.ok(tools.includes("late_tool"));
  } finally {
    await f.cleanup();
  }
});

test("agent edits flag open sessions as changed; reload applies them from the same transcript", async () => {
  const f = await fixture();
  try {
    await f.agent("dev", { name: "Dev" }, { "instructions/a.md": "FIRST-VERSION" });
    const session = await f.runtime.create({ folder: f.folder, agent: "dev" });
    const other = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(session.id, "hello").completion;
    assert.equal(f.runtime.session(session.id).agentChanged, undefined);
    const file = f.runtime.agents.readFile({ agent: "dev" }, "instructions/a.md");
    f.runtime.agents.writeFile({ agent: "dev" }, "instructions/a.md", file.revision, "SECOND-VERSION");
    assert.equal(f.runtime.session(session.id).agentChanged, true);
    assert.equal(f.runtime.session(other.id).agentChanged, undefined, "Default sessions are unaffected");
    f.provider.automatic = false;
    const run = f.runtime.start(session.id, "busy");
    await eventually(() => f.provider.active === 1);
    await assert.rejects(f.runtime.reload(session.id), (e) => e instanceof RuntimeError && e.code === "busy");
    f.provider.requests.at(-1)!.release();
    await run.completion;
    f.provider.automatic = true;
    const reloaded = await f.runtime.reload(session.id);
    assert.equal(reloaded.agentChanged, undefined);
    await f.runtime.start(session.id, "after reload").completion;
    const last = f.provider.requests.at(-1)!;
    assert.match(systemText(last), /SECOND-VERSION/);
    assert.match(JSON.stringify(last.context.messages), /hello/, "same transcript");
  } finally {
    await f.cleanup();
  }
});

test("an in-session edit gives the session its own layer; the agent itself is unchanged", async () => {
  const f = await fixture();
  try {
    await f.agent(
      "dev",
      { name: "Dev" },
      { "skills/review/SKILL.md": "---\nname: review\ndescription: REVIEW-SKILL\n---\n" },
    );
    const session = await f.runtime.create({ folder: f.folder, agent: "dev" });
    f.runtime.agents.save({ session: session.id }, "", { base: ["dev"], off: ["skill:review"] });
    f.runtime.agents.writeFile({ session: session.id }, "instructions/extra.md", null, "SESSION-ONLY");
    assert.equal(f.runtime.session(session.id).agentChanged, true);
    await f.runtime.reload(session.id);
    await f.runtime.start(session.id, "go").completion;
    const request = f.provider.requests.at(-1)!;
    assert.match(systemText(request), /SESSION-ONLY/);
    assert.doesNotMatch(systemText(request), /REVIEW-SKILL/);
    assert.deepEqual(f.runtime.list().find((c) => c.id === session.id)!.agent, {
      id: "dev",
      name: "Dev",
      layered: true,
    });
    const fresh = await f.runtime.create({ folder: f.folder, agent: "dev" });
    await f.runtime.start(fresh.id, "fresh").completion;
    assert.match(systemText(f.provider.requests.at(-1)!), /REVIEW-SKILL/);
    assert.doesNotMatch(systemText(f.provider.requests.at(-1)!), /SESSION-ONLY/);
  } finally {
    await f.cleanup();
  }
});

test("model choice: Ask's model, else the agent's preferred model, else the default", async () => {
  const h = await testHome("pispark-agent-models-");
  const settings = await localProviderSettings(join(h.root, "providers"));
  settings.control.automatic = true;
  const provider = "pispark-local-test";
  await writeFile(settings.authPath, JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }));
  await settings.runtime.refresh({ allowNetwork: false });
  await settings.settings.setDefault({ provider, id: "deterministic" });
  const runtime = new SessionRuntime({ home: h.home }, settings.settings);
  try {
    const folder = await h.folder("work");
    await h.agent("fast", { name: "Fast", settings: { model: `${provider}/second` } });
    await h.agent("gone", { name: "Gone", settings: { model: "nowhere/none" } });
    assert.equal((await runtime.create({ folder })).model?.id, "deterministic");
    assert.equal((await runtime.create({ folder, agent: "fast" })).model?.id, "second");
    assert.equal(
      (await runtime.create({ folder, agent: "fast", model: { provider, id: "deterministic" } })).model?.id,
      "deterministic",
    );
    assert.equal((await runtime.create({ folder, agent: "gone" })).model?.id, "deterministic");
  } finally {
    await runtime.shutdown();
    await settings.settings.close();
    await h.remove();
  }
});

test("a native model switch stays attached to just that session on reopen", async () => {
  const h = await testHome("pispark-session-model-");
  const settings = await localProviderSettings(join(h.root, "providers"));
  const provider = "pispark-local-test";
  settings.control.automatic = true;
  const runtime = new SessionRuntime({ home: h.home }, settings.settings);
  try {
    await writeFile(settings.authPath, JSON.stringify({ [provider]: { type: "api_key", key: "test-key" } }));
    await settings.runtime.refresh({ allowNetwork: false });
    await settings.settings.setDefault({ provider, id: "deterministic" });
    const folder = await h.folder("work");
    await h.agent("fast", { name: "Fast", settings: { model: `${provider}/second` } }, {
      "extensions/switch.js": `export default pi => pi.registerCommand("switch-model", {
        description: "Switch this session", handler: async (_, ctx) => {
          await pi.setModel(ctx.modelRegistry.find("${provider}", "deterministic"));
        }
      })`,
    });
    const create = () => runtime.create({ agent: "fast", folder });
    const a = await create(), b = await create();
    const checkDispatch = async (id: string, expected: string) => {
      const before = settings.control.requests.length;
      assert.equal((await runtime.start(id, "Hello").completion).outcome, "completed");
      assert.deepEqual(settings.control.requests.slice(before).map(r => r.model.id), [expected]);
    };
    await checkDispatch(a.id, "second");
    await runtime.start(a.id, "/switch-model").completion;
    await checkDispatch(a.id, "deterministic");
    await runtime.stop(a.id);
    await runtime.open(a.id);
    await checkDispatch(a.id, "deterministic");
    await checkDispatch(b.id, "second");
    await checkDispatch((await create()).id, "second");
  } finally {
    await runtime.shutdown();
    await settings.settings.close();
    await h.remove();
  }
});

test("editing any file of an extension folder outside PiSpark flags open sessions; a single-file extension is its file", async () => {
  const f = await fixture();
  try {
    const extension = "export default function (pi) { pi.on(\"session_start\", () => {}); }\n";
    await f.agent("ext", { name: "Ext" }, {
      "extensions/panel/index.ts": extension,
      "extensions/panel/Panel.svelte": "<p>first</p>\n",
      "extensions/panel/helper.js": "export const a = 1;\n",
      "extensions/single.ts": extension,
    });
    const session = await f.runtime.create({ folder: f.folder, agent: "ext" });
    assert.equal(f.runtime.session(session.id).agentChanged, undefined);
    // A component edited in an editor, not through PiSpark.
    const dir = join(f.home, "agents", "ext", "extensions");
    await writeFile(join(dir, "panel", "Panel.svelte"), "<p>second, a little longer</p>\n");
    await eventually(() => f.runtime.session(session.id).agentChanged === true);
    await f.runtime.reload(session.id);
    assert.equal(f.runtime.session(session.id).agentChanged, undefined);
    await writeFile(join(dir, "single.ts"), extension + "// edited\n");
    await eventually(() => f.runtime.session(session.id).agentChanged === true);
  } finally {
    await f.cleanup();
  }
});

test("a project agent works in its own folder and reads its AGENTS.md; other agents read nothing from the folder", async () => {
  const f = await fixture();
  try {
    const invalid = (error: unknown) => error instanceof RuntimeError && error.code === "invalid-input";
    const project = join(f.root, "project");
    await mkdir(project);
    await writeFile(join(project, "AGENTS.md"), "PROJECT-RULES");
    await f.agent("project", { name: "Project", folder: project });
    const session = await f.runtime.create({ agent: "project" });
    assert.equal(session.folder, await realpath(project));
    await f.runtime.start(session.id, "hello").completion;
    assert.match(systemText(f.provider.requests.at(-1)!), /PROJECT-RULES/);
    // The folder is the agent's to decide: naming one, even its own, is refused.
    await assert.rejects(f.runtime.create({ agent: "project", folder: project }), invalid);
    // Any other agent is given a folder, and reads nothing from it.
    await assert.rejects(f.runtime.create({}), invalid);
    const plain = await f.runtime.create({ folder: project });
    await f.runtime.start(plain.id, "hello").completion;
    assert.doesNotMatch(systemText(f.provider.requests.at(-1)!), /PROJECT-RULES/);
    assert.equal(f.runtime.list().length, 2);
  } finally {
    await f.cleanup();
  }
});

test("an app agent's session says its home view and, given no folder, starts in the app's own folder under the data root", async () => {
  const f = await fixture();
  try {
    await f.agent("app", { name: "App", home: "desk" });
    await f.agent("project-app", { name: "Project app", base: ["app"], folder: f.folder });
    const opened = await f.runtime.create({ agent: "app" });
    assert.equal(opened.folder, await realpath(join(f.home, "apps", "app")));
    assert.deepEqual(opened.agent, { id: "app", name: "App", layered: false, home: "desk" });
    assert.equal(f.runtime.list().find((session) => session.id === opened.id)!.agent.home, "desk");
    // No message was sent, and the session is kept all the same: it opens again after it unloads.
    await f.runtime.stop(opened.id);
    assert.equal((await f.runtime.open(opened.id)).agent.home, "desk");
    // Started from Ask in another folder, it works there.
    assert.equal((await f.runtime.create({ agent: "app", folder: f.folder })).folder, await realpath(f.folder));
    // A project app lives in its project's folder.
    const project = await f.runtime.create({ agent: "project-app" });
    assert.equal(project.folder, await realpath(f.folder));
    assert.equal(project.agent.home, "desk");
    // An agent that is neither still needs a folder.
    assert.equal(f.runtime.session(await f.runtime.create({ folder: f.folder }).then((doc) => doc.id)).agent.home, undefined);
  } finally {
    await f.cleanup();
  }
});

test("every session is told it runs in PiSpark and gets PiSpark's own skills, which agents don't list or switch", async () => {
  const f = await fixture();
  try {
    // Even an agent that switches every skill of its own off.
    await f.agent("plain", { name: "Plain", off: ["skill:pispark", "skill:pispark-extensions"] });
    const session = await f.runtime.create({ folder: f.folder, agent: "plain" });
    await f.runtime.start(session.id, "hello").completion;
    const system = systemText(f.provider.requests.at(-1)!);
    assert.match(system, /You are working in PiSpark/);
    const files = JSON.stringify(join(f.runtime.dataFolder, "sessions", session.id, "files")).slice(1, -1);
    assert.ok(system.includes(files), "the session's files folder is named");
    for (const skill of BUILT_IN_SKILLS)
      assert.ok(system.includes(JSON.stringify(join(skill, "SKILL.md")).slice(1, -1)), `${skill} is offered`);
    // Part of the system, not the agent: the editor lists none of them.
    const view = viewAgent(f.runtime.agents, { agent: "plain" });
    assert.ok(!view.items.some((item) => item.name.startsWith("pispark")));
  } finally {
    await f.cleanup();
  }
});

test("between replies a session's thinking level and model can change; the choice stays on reopen; never mid-reply", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(session.id, "first").completion;
    let doc = f.runtime.session(session.id);
    // Pi says what the model offers and how full its context is.
    assert.ok(doc.thinking && doc.thinking.levels.includes(doc.thinking.level));
    assert.equal(doc.context?.window, 100_000);
    // A level the model doesn't offer is clamped by Pi to one it does.
    doc = await f.runtime.configure(session.id, { thinking: "high" });
    assert.ok(doc.thinking!.levels.includes(doc.thinking!.level));
    const chosen = doc.thinking!.level;
    await f.runtime.stop(session.id);
    await f.runtime.open(session.id);
    assert.equal(f.runtime.session(session.id).thinking!.level, chosen, "kept on reopen");
    // A model that isn't offered is refused, and nothing changes.
    const model = f.runtime.session(session.id).model;
    await assert.rejects(f.runtime.configure(session.id, { model: { provider: model!.provider, id: "no-such-model" } }), (e) => e instanceof RuntimeError && e.code === "model-unavailable");
    assert.deepEqual(f.runtime.session(session.id).model, model);
    // Not while a reply runs.
    f.provider.automatic = false;
    const run = f.runtime.start(session.id, "slow");
    await eventually(() => f.provider.active === 1);
    await assert.rejects(f.runtime.configure(session.id, { thinking: "off" }), (e) => e instanceof RuntimeError && e.code === "busy");
    f.provider.requests.at(-1)!.release();
    await run.completion;
    await assert.rejects(f.runtime.configure(session.id, {}), (e) => e instanceof RuntimeError && e.code === "invalid-input");
  } finally {
    await f.cleanup();
  }
});

test("after a failed reply, the next message goes: the session starts again from its transcript", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    assert.deepEqual((await f.runtime.start(session.id, "provider-error").completion).outcome, "failed");
    assert.equal(f.runtime.session(session.id).status, "error");
    // What a command does first (as the HTTP start does): the errored session opens again.
    await f.runtime.ensure(session.id);
    assert.equal(f.runtime.session(session.id).status, "idle");
    assert.deepEqual(await f.runtime.start(session.id, "after the failure").completion, { outcome: "completed" });
    assert.match(sessionText(f.runtime, session.id), /after the failure/);
  } finally {
    await f.cleanup();
  }
});
