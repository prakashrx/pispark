import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentStore } from "../src/core/agents/store.js";
import { frontmatter } from "../src/core/agents/format.js";
import { listAgents, resolveSetup } from "../src/core/agents/resolve.js";
import agentBuilder from "../../../plugins/agents/agent-builder/extensions/agent-builder/index.js";

const PLUGINS = fileURLToPath(new URL("../../../plugins/", import.meta.url));
const AGENT_BUILDER = join(PLUGINS, "agents", "agent-builder");

async function fixture(t: TestContext, bundled?: string) {
  const root = await mkdtemp(join(tmpdir(), "pispark-builder-"));
  await mkdir(join(root, "sessions"));
  const plugins = bundled ?? join(root, "app", "plugins");
  const store = new AgentStore(join(root, "agents"), join(root, "sessions"), () => "default", undefined, plugins);
  t.after(async () => {
    await store.shutdown();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  async function put(file: string, content: string) {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return path;
  }
  return { root, store, put };
}

test("an agent the app ships is listed, read-only and can be built on", async (t) => {
  const { store, put } = await fixture(t);
  await put("app/plugins/agents/helper/agent.json", JSON.stringify({ name: "Helper", resources: { skills: ["local:guide"] } }));
  const guide = await put("app/plugins/agents/helper/skills/guide/SKILL.md", "---\nname: guide\ndescription: Guide\n---\n# Guide\n");
  // A data folder of the same name is ignored: the ID belongs to the app.
  await put("agents/helper/agent.json", JSON.stringify({ name: "Mine" }));

  const listed = listAgents(store).find((agent) => agent.id === "helper");
  assert.deepEqual([listed?.name, listed?.bundled, listed?.builtIn], ["Helper", true, false]);
  assert.equal(listAgents(store).filter((agent) => agent.id === "helper").length, 1);
  assert.deepEqual(resolveSetup(store, { agent: "helper" }).skillDirs, [dirname(guide)]);

  const helper = { agent: "helper" };
  const { revision } = store.read(helper);
  const refused = { code: "built-in" };
  assert.throws(() => store.save(helper, revision, { name: "Changed" }), refused);
  assert.throws(() => store.setSwitch("helper", "skill:guide", false), refused);
  assert.throws(() => store.select(helper, "skills", "local:guide", false, revision), refused);
  assert.throws(() => store.writeFile(helper, "instructions/new.md", null, "Hi"), refused);
  assert.throws(() => store.deleteFile(helper, "skills/guide/SKILL.md", store.readFile(helper, "skills/guide/SKILL.md").revision), refused);
  assert.throws(() => store.remove("helper"), refused);
  assert.match(await readFile(guide, "utf8"), /# Guide/);

  assert.equal(store.create({ name: "Helper" }).id, "helper-2");
  const child = { agent: store.create({ name: "Child", base: ["helper"] }).id };
  assert.deepEqual(resolveSetup(store, child).skillDirs, [dirname(guide)]);
});

test("Agent Builder ships with its skills and extension, and without shell or session tools", async (t) => {
  const { store } = await fixture(t, PLUGINS);
  assert.ok(listAgents(store).some((agent) => agent.id === "agent-builder" && agent.bundled && agent.valid));
  const setup = resolveSetup(store, { agent: "agent-builder" });
  assert.deepEqual(setup.instructions.map((i) => i.name), ["agent-builder"]);
  assert.equal(setup.extensionPaths.length, 1);
  const skills = await readdir(join(AGENT_BUILDER, "skills"));
  assert.deepEqual(setup.skillDirs.map((dir) => dir.split(/[\\/]/).at(-1)).sort(), skills.sort());
  for (const tool of ["bash", "pispark_session", "pispark_schedule", "pispark_process", "pispark_extension"])
    assert.ok(setup.toolsOff.includes(tool), tool);
  for (const tool of ["read", "edit", "write", "grep", "find", "ls"])
    assert.ok(setup.toolsOn.includes(tool), tool);
  for (const name of skills) {
    const { data } = frontmatter(await readFile(join(AGENT_BUILDER, "skills", name, "SKILL.md"), "utf8"));
    assert.equal(data.name, name);
    assert.ok(data.description && data.description.length <= 1024, name);
  }
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

test("Agent Builder asks before writing outside the agent and never changes app files", async (t) => {
  const { root, put } = await fixture(t);
  const agent = join(root, "agents", "shop");
  await put("agents/shop/agent.json", "{}");
  const shared = await put("resources/skills/review/SKILL.md", "x");
  const handlers = new Map<string, Handler>();
  agentBuilder({ on: (name: string, handler: Handler) => handlers.set(name, handler) } as never);
  const asked: string[] = [];
  let answer = false;
  const ctx = { cwd: agent, ui: { confirm: async (_title: string, message: string) => (asked.push(message), answer) } };
  const call = (path: string, toolName = "write") => handlers.get("tool_call")!({ toolName, input: { path } }, ctx) as Promise<{ block?: boolean; reason?: string } | undefined>;

  assert.equal(await call("skills/new/SKILL.md"), undefined);
  assert.equal(await call(join(agent, "agent.json"), "edit"), undefined);
  assert.equal(await call(shared, "read"), undefined);
  assert.deepEqual(asked, []);

  assert.equal((await call(shared))?.block, true);
  assert.match(asked[0]!, /the shared skill "review"\. Every agent that uses it changes too/);
  answer = true;
  assert.equal(await call(shared, "edit"), undefined);
  assert.equal(await call(shared), undefined);
  assert.equal(asked.length, 2, "an allowed file isn't asked about again");
  assert.match(asked[1]!, /^Agent Builder wants to edit /);

  await put("agents/writer/agent.json", "{}");
  await call(join(root, "agents", "writer", "agent.json"));
  assert.match(asked[2]!, /the agent "writer"/);

  const shipped = await call(join(AGENT_BUILDER, "agent.json"));
  assert.equal(shipped?.block, true);
  assert.match(shipped!.reason!, /ships with PiSpark/);
  assert.equal(asked.length, 3, "app files are refused without asking");

  const prompt = (await handlers.get("before_agent_start")!({ systemPrompt: "Base." }, ctx)) as { systemPrompt: string };
  assert.ok(prompt.systemPrompt.startsWith("Base.\n\n## Agent Builder"));
  assert.ok(prompt.systemPrompt.includes(`working folder, ${agent}.`));
  const elsewhere = (await handlers.get("before_agent_start")!({ systemPrompt: "" }, { cwd: root })) as { systemPrompt: string };
  assert.match(elsewhere.systemPrompt, /isn't an agent's folder/);
});
