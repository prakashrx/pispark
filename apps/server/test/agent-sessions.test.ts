import { EXTENSION_TOOL } from "../src/core/runtime/extension-tool.js";
import { viewAgent } from "../src/core/agents/resolve.js";
import { BUILT_IN_SKILLS } from "../src/core/runtime/configuration.js";
import { toolOf, VERBS } from "../src/contract/verbs.js";
import { say } from "./fixtures/verbs.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { RuntimeError } from "../src/core/runtime/errors.js";
import { DEFAULT_TOOLS } from "../src/core/agents/format.js";
import { TITLE_TOOL } from "../src/core/runtime/session-title.js";
import { eventually } from "./fixtures/local-provider.js";
import { localProviderSettings } from "./fixtures/provider-settings.js";
import { testHome } from "./fixtures/home.js";
import type { LocalRequest } from "./fixtures/local-provider.js";
import { sessionText } from "./fixtures/session.js";
import type { Item } from "../src/contract/protocol.js";

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
/** Whether a condition holds now; false while the session is briefly not loaded (as it reloads). */
const now = (condition: () => boolean) => () => {
  try {
    return condition();
  } catch {
    return false;
  }
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
      [...DEFAULT_TOOLS, "codemode", "tool_search", EXTENSION_TOOL, TITLE_TOOL, ...VERBS.map(toolOf)].sort(),
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

test("Pi's codemode and tool search are on by default; an agent switches them off and an extension replaces them", async () => {
  const f = await fixture();
  try {
    const own = `export default pi => pi.registerTool({name:'codemode',label:'Mine',description:'MY-CODEMODE',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'ok'}],details:undefined})});`;
    await f.agent("plain", { name: "Plain" });
    await f.agent("lean", { name: "Lean", off: ["tool:codemode", "tool:tool_search"] });
    await f.agent("own", { name: "Own" }, { "extensions/own.mjs": own });
    for (const [agent, expect] of [["plain", true], ["lean", false]] as const) {
      const session = await f.runtime.create({ folder: f.folder, agent });
      await f.runtime.start(session.id, "hello").completion;
      const tools = toolsOf(f.provider.requests.at(-1)!);
      assert.equal(tools.includes("codemode"), expect, `${agent}: codemode`);
      assert.equal(tools.includes("tool_search"), expect, `${agent}: tool_search`);
      assert.ok(tools.includes("read"));
    }
    const session = await f.runtime.create({ folder: f.folder, agent: "own" });
    await f.runtime.start(session.id, "hello").completion;
    const request = f.provider.requests.at(-1)!;
    assert.ok(toolsOf(request).includes("codemode"));
    assert.match(systemText(request), /MY-CODEMODE/, "the extension's codemode, not Pi's");
    assert.ok(toolsOf(request).includes("tool_search"));
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
    // Asked for while a reply runs, the reload waits for it, then applies the change.
    f.provider.automatic = false;
    const run = f.runtime.start(session.id, "busy");
    await eventually(() => f.provider.active === 1);
    assert.deepEqual((await f.runtime.reload(session.id)).pending, { reload: true });
    assert.equal(f.runtime.session(session.id).agentChanged, true);
    f.provider.requests.at(-1)!.release();
    await run.completion;
    f.provider.automatic = true;
    await eventually(now(() => f.runtime.session(session.id).status === "idle" && !f.runtime.session(session.id).agentChanged));
    const reloaded = await f.runtime.reload(session.id);
    assert.equal(reloaded.agentChanged, undefined);
    assert.equal(reloaded.pending, undefined);
    await f.runtime.start(session.id, "after reload").completion;
    const last = f.provider.requests.at(-1)!;
    assert.match(systemText(last), /SECOND-VERSION/);
    assert.match(JSON.stringify(last.context.messages), /hello/, "same transcript");
  } finally {
    await f.cleanup();
  }
});

test("the agent asks for a reload: it waits for the turn to end, then wakes the agent with the outcome", async () => {
  const f = await fixture();
  try {
    await f.agent("dev", { name: "Dev" }, { "instructions/a.md": "FIRST-VERSION" });
    const session = await f.runtime.create({ folder: f.folder, agent: "dev" });
    await f.runtime.start(session.id, "hello").completion;
    const file = f.runtime.agents.readFile({ agent: "dev" }, "instructions/a.md");
    f.runtime.agents.writeFile({ agent: "dev" }, "instructions/a.md", file.revision, "SECOND-VERSION");
    f.provider.automatic = false;
    const run = f.runtime.start(session.id, say("self", { action: "reload" }));
    await eventually(() => f.provider.active === 1);
    f.provider.requests.at(-1)!.release();
    await eventually(() => f.runtime.session(session.id).pending?.reload === true);
    assert.match(sessionText(f.runtime, session.id), /reloads when this turn ends/);
    f.provider.automatic = true;
    f.provider.requests.at(-1)!.release();
    await run.completion;
    await eventually(now(() => /This reload was asked for by pispark_self/.test(sessionText(f.runtime, session.id))));
    await eventually(now(() => f.runtime.session(session.id).status === "idle"));
    const woken = f.provider.requests.at(-1)!;
    assert.match(systemText(woken), /SECOND-VERSION/);
    assert.match(JSON.stringify(woken.context.messages), /reloaded with its agent's current setup/);
    assert.match(JSON.stringify(woken.context.messages), /hello/, "same transcript");
    assert.equal(f.runtime.session(session.id).agentChanged, undefined);
    assert.equal(f.runtime.session(session.id).pending, undefined);
  } finally {
    await f.cleanup();
  }
});

test("an extension command's ctx.reload() is the session's reload; extensions see Pi's reload reasons and the agent is not woken", async () => {
  const f = await fixture();
  const reasons: string[] = [];
  (globalThis as { reloadReasons?: string[] }).reloadReasons = reasons;
  try {
    await f.agent("dev", { name: "Dev" }, {
      "instructions/a.md": "FIRST-VERSION",
      "extensions/refresh.js": `export default pi => {
        pi.on("session_start", (event) => globalThis.reloadReasons.push("start:" + event.reason));
        pi.on("session_shutdown", (event) => globalThis.reloadReasons.push("shutdown:" + event.reason));
        pi.registerCommand("refresh", { description: "Reload this session", handler: async (_, ctx) => { await ctx.reload(); } });
      }`,
    });
    const session = await f.runtime.create({ folder: f.folder, agent: "dev" });
    await f.runtime.start(session.id, "hello").completion;
    const file = f.runtime.agents.readFile({ agent: "dev" }, "instructions/a.md");
    f.runtime.agents.writeFile({ agent: "dev" }, "instructions/a.md", file.revision, "SECOND-VERSION");
    const requests = f.provider.requests.length;
    reasons.length = 0;
    assert.equal((await f.runtime.start(session.id, "/refresh").completion).outcome, "completed");
    await eventually(now(() => reasons.includes("start:reload") && f.runtime.session(session.id).status === "idle"));
    assert.deepEqual(reasons, ["shutdown:reload", "start:reload"]);
    assert.equal(f.runtime.session(session.id).agentChanged, undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(f.provider.requests.length, requests, "nothing woke the agent");
    await f.runtime.start(session.id, "after").completion;
    assert.match(systemText(f.provider.requests.at(-1)!), /SECOND-VERSION/);
    // A plain stop is still a quit.
    reasons.length = 0;
    await f.runtime.stop(session.id);
    assert.deepEqual(reasons, ["shutdown:quit"]);
  } finally {
    delete (globalThis as { reloadReasons?: string[] }).reloadReasons;
    await f.cleanup();
  }
});

test("an extension adds skills and prompts to its session through Pi's resources_discover; new ones load on reload; the agent's own win a clash", async () => {
  const f = await fixture();
  const discovered: string[] = [];
  (globalThis as { discovered?: string[] }).discovered = discovered;
  const found = join(f.folder, ".found");
  const files: Record<string, string> = {
    "skills/notes/SKILL.md": "---\nname: notes\ndescription: FOUND-SKILL notes\n---\nSteps",
    "skills/review/SKILL.md": "---\nname: review\ndescription: FOUND-REVIEW should lose\n---\n",
    "prompts/brief.md": "---\ndescription: Brief\n---\nBRIEF-TEMPLATE about $1",
    "prompts/outline.md": "FOUND-OUTLINE should lose",
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(found, path, ".."), { recursive: true });
    await writeFile(join(found, path), text);
  }
  try {
    await f.agent("dev", { name: "Dev" }, {
      "skills/review/SKILL.md": "---\nname: review\ndescription: AGENT-REVIEW wins\n---\n",
      "prompts/outline.md": "---\ndescription: Outline\n---\nAGENT-OUTLINE about $1",
      "extensions/found.mjs": `export default pi => {
        pi.registerCommand("refresh", { description: "Reload", handler: async (_, ctx) => { await ctx.reload(); } });
        pi.on("resources_discover", (event) => { globalThis.discovered?.push(event.reason); return {
          skillPaths: [${JSON.stringify(join(found, "skills"))}],
          promptPaths: [${JSON.stringify(join(found, "prompts"))}],
        }; });
      }`,
    });
    const session = await f.runtime.create({ folder: f.folder, agent: "dev" });
    await f.runtime.start(session.id, "/brief pancakes").completion;
    assert.deepEqual(discovered, ["startup"]);
    let request = f.provider.requests.at(-1)!;
    assert.match(systemText(request), /FOUND-SKILL notes/);
    assert.match(systemText(request), /AGENT-REVIEW wins/);
    assert.doesNotMatch(systemText(request), /FOUND-REVIEW/);
    assert.match(JSON.stringify(request.context.messages.at(-1)), /BRIEF-TEMPLATE about pancakes/);
    await f.runtime.start(session.id, "/outline waffles").completion;
    assert.match(JSON.stringify(f.provider.requests.at(-1)!.context.messages.at(-1)), /AGENT-OUTLINE about waffles/);
    // A skill written while the session runs is there after a reload.
    await mkdir(join(found, "skills", "later"), { recursive: true });
    await writeFile(join(found, "skills", "later", "SKILL.md"), "---\nname: later\ndescription: LATER-SKILL added\n---\n");
    await f.runtime.start(session.id, "/refresh").completion;
    await eventually(now(() => discovered.includes("reload") && f.runtime.session(session.id).status === "idle"));
    await f.runtime.start(session.id, "after").completion;
    request = f.provider.requests.at(-1)!;
    assert.match(systemText(request), /LATER-SKILL added/);
    assert.match(systemText(request), /FOUND-SKILL notes/);
  } finally {
    delete (globalThis as { discovered?: string[] }).discovered;
    await f.cleanup();
  }
});

test("stopping the turn drops the reload its agent asked for", async () => {
  const f = await fixture();
  try {
    await f.agent("dev", { name: "Dev" }, { "instructions/a.md": "FIRST-VERSION" });
    const session = await f.runtime.create({ folder: f.folder, agent: "dev" });
    const file = f.runtime.agents.readFile({ agent: "dev" }, "instructions/a.md");
    f.runtime.agents.writeFile({ agent: "dev" }, "instructions/a.md", file.revision, "SECOND-VERSION");
    f.provider.automatic = false;
    const run = f.runtime.start(session.id, say("self", { action: "reload" }));
    await eventually(() => f.provider.active === 1);
    f.provider.requests.at(-1)!.release();
    await eventually(() => f.runtime.session(session.id).pending?.reload === true);
    await f.runtime.cancel(session.id);
    await run.completion;
    f.provider.automatic = true;
    await eventually(() => f.runtime.session(session.id).pending === undefined);
    const requests = f.provider.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(f.provider.requests.length, requests, "nothing woke the agent");
    assert.equal(f.runtime.session(session.id).agentChanged, true, "not reloaded");
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
    assert.match(system, /This Pi session runs in PiSpark, not a terminal/);
    assert.match(system, /GitHub Markdown .*inline images, file previews and rich tool results/);
    assert.match(system, /extensions can customize rendering and add views and controls/);
    assert.doesNotMatch(system, /Turn the request into the smallest useful definition/, "the workspace skill body is loaded on demand");
    assert.doesNotMatch(system, /project-location/, "the extension skill example is loaded on demand");
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

test("a session's thinking level and model can change; the choice stays on reopen; one asked for mid-reply waits for the reply", async () => {
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
    // Asked for while a reply runs, it waits, and applies once the reply is done.
    f.provider.automatic = false;
    const run = f.runtime.start(session.id, "slow");
    await eventually(() => f.provider.active === 1);
    const waiting = await f.runtime.configure(session.id, { thinking: "off" });
    assert.deepEqual(waiting.pending, { thinking: "off" });
    assert.equal(waiting.thinking!.level, chosen, "the running reply keeps its level");
    f.provider.requests.at(-1)!.release();
    await run.completion;
    await eventually(() => f.runtime.session(session.id).pending === undefined);
    assert.equal(f.runtime.session(session.id).thinking!.level, "off");
    await assert.rejects(f.runtime.configure(session.id, {}), (e) => e instanceof RuntimeError && e.code === "invalid-input");
  } finally {
    await f.cleanup();
  }
});

test("Pi retries an overloaded provider by itself and the session says so; a failure says why, in the provider's words", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    const run = f.runtime.start(session.id, "provider-overloaded-once");
    await eventually(() => f.runtime.session(session.id).retrying !== undefined);
    const retrying = f.runtime.session(session.id).retrying!;
    assert.deepEqual([retrying.attempt, retrying.of, retrying.failure], [1, 3, "unavailable"]);
    assert.ok(Date.parse(retrying.at) > Date.now() - 1000);
    assert.equal((await run.completion).outcome, "completed");
    assert.equal(f.runtime.session(session.id).retrying, undefined);
    const replies = () => f.runtime.items(session.id, {}).items.filter((item) => item.role === "assistant");
    // The failed attempt stays in the history (Pi hides it from the model); the reply after it finished.
    assert.equal(replies().at(-2)!.failure, "unavailable");
    assert.equal(replies().at(-1)!.stopReason, "stop");

    assert.equal((await f.runtime.start(session.id, "provider-error").completion).outcome, "failed");
    const failed = replies().at(-1)!;
    assert.equal(failed.failure, "failed");
    assert.match(failed.error ?? "", /^Fixture error/);
    assert.equal(failed.provider, "pispark-local-test");
  } finally {
    await f.cleanup();
  }
});

test("a message edited and sent again branches through Pi's tree; versions switch and stay chosen; a fork can start at a reply", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(session.id, "first").completion;
    await f.runtime.start(session.id, "second").completion;
    const items = () => f.runtime.items(session.id, {}).items;
    const userText = () => items().filter((item) => item.role === "user").map((item) => (item.parts[0] as { text: string }).text);
    const second = items().filter((item) => item.role === "user")[1]!;
    const firstReply = items().filter((item) => item.role === "assistant")[0]!;

    assert.equal((await (await f.runtime.edit(session.id, second.id!, "second, edited")).completion).outcome, "completed");
    assert.deepEqual(userText(), ["first", "second, edited"]);
    const edited = items().filter((item) => item.role === "user")[1]!;
    assert.deepEqual(edited.versions, { at: 2, of: 2, previous: second.id });
    // The model saw the conversation without the message that was replaced.
    assert.doesNotMatch(JSON.stringify(f.provider.requests.at(-1)!.context.messages), /"second"/);

    await f.runtime.branch(session.id, second.id!);
    assert.deepEqual(userText(), ["first", "second"]);
    assert.deepEqual(items().filter((item) => item.role === "user")[1]!.versions, { at: 1, of: 2, next: edited.id });
    // The chosen version is where the session opens again.
    await f.runtime.stop(session.id);
    await f.runtime.open(session.id);
    assert.deepEqual(userText(), ["first", "second"]);
    await assert.rejects(f.runtime.edit(session.id, firstReply.id!, "not a message of yours"), (e) => e instanceof RuntimeError && e.code === "not-found");

    const forkId = await f.runtime.fork(session.id, firstReply.id!);
    await f.runtime.open(forkId);
    assert.deepEqual(f.runtime.items(forkId, {}).items.map((item) => item.role), ["user", "assistant"]);
  } finally {
    await f.cleanup();
  }
});

test("the live stream carries an edited message's versions", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(session.id, "first").completion;
    await f.runtime.start(session.id, "second").completion;
    const second = f.runtime.items(session.id, {}).items.filter((item) => item.role === "user")[1]!;
    const { view, events } = f.runtime.observeLive(session.id);
    try {
      const committed: Item[] = [];
      const run = await f.runtime.edit(session.id, second.id!, "second, edited");
      const take = () => {
        const event = view.next();
        if (event?.type === "ops") for (const op of event.ops) if (op.op === "commit") committed.push(...(op.items ?? []));
      };
      take();
      await run.completion;
      take();
      const edited = committed.find((item) => item.role === "user");
      assert.deepEqual(edited?.versions, { at: 2, of: 2, previous: second.id });
    } finally {
      events.close();
    }
  } finally {
    await f.cleanup();
  }
});

test("an extension command's ctx.navigateTree moves in place and ctx.fork makes a session of its own", async () => {
  const f = await fixture();
  try {
    await f.agent("dev", { name: "Dev" }, {
      "extensions/tree.js": `export default pi => {
        const firstReply = (ctx) => ctx.sessionManager.getBranch().find((e) => e.type === "message" && e.message.role === "assistant");
        pi.registerCommand("rewind", { handler: async (_, ctx) => { await ctx.navigateTree(firstReply(ctx).id); } });
        pi.registerCommand("split", { handler: async (_, ctx) => { await ctx.fork(firstReply(ctx).id, { position: "at" }); } });
      }`,
    });
    const session = await f.runtime.create({ folder: f.folder, agent: "dev" });
    await f.runtime.start(session.id, "first").completion;
    await f.runtime.start(session.id, "second").completion;
    const before = f.runtime.list().length;
    assert.equal((await f.runtime.start(session.id, "/split").completion).outcome, "completed");
    assert.equal(f.runtime.list().length, before + 1);
    assert.equal((await f.runtime.start(session.id, "/rewind").completion).outcome, "completed");
    assert.deepEqual(f.runtime.items(session.id, {}).items.filter((item) => item.role === "user").map((item) => (item.parts[0] as { text: string }).text), ["first"]);
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
