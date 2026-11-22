import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentStore } from "../src/core/agents/store.js";
import { migrateAgentResources } from "../src/core/agents/migrate.js";
import { resolveSetup } from "../src/core/agents/resolve.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pispark-resources-"));
  await mkdir(join(root, "sessions"));
  const bundled = join(root, "app", "plugins");
  const store = new AgentStore(join(root, "agents"), join(root, "sessions"), () => "default", undefined, bundled);
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

const skill = (name: string) => "---\nname: " + name + "\ndescription: Research\n---\n# " + name + "\n";

test("the inventory spans three sources; only explicit declarations and their companions load", async (t) => {
  const { store, put } = await fixture(t);
  const defaultAgent = { agent: "default" };
  const { id } = store.create({ name: "Research" });
  const research = { agent: id };
  const bundled = await put("app/plugins/extensions/research/index.ts", "export default () => {};\n");
  const companion = await put("app/plugins/extensions/research/skills/research-verify/SKILL.md", skill("research-verify"));
  const shared = await put("resources/extensions/research/index.ts", "export default () => {};\n");
  const sharedSkill = await put("resources/skills/guide/SKILL.md", skill("guide"));
  const local = await put("agents/research/skills/private-note/SKILL.md", skill("private-note"));
  await put("app/plugins/mcp/catalog.json", '{"url":"https://example.com/mcp"}');

  assert.deepEqual(store.available(research, "extensions").map(({ reference }) => reference), ["bundled:research", "shared:research"]);
  assert.deepEqual(store.available(research, "skills").map(({ reference }) => reference), ["shared:guide", "local:private-note"]);
  assert.deepEqual(resolveSetup(store, research).extensionPaths, []);
  assert.deepEqual(resolveSetup(store, research).skillDirs, []);
  assert.deepEqual(resolveSetup(store, research).mcpServers, {});

  store.select(research, "extensions", "bundled:research", true, store.read(research).revision);
  store.select(research, "skills", "shared:guide", true, store.read(research).revision);
  store.select(research, "skills", "local:private-note", true, store.read(research).revision);
  store.select(research, "mcp", "bundled:catalog", true, store.read(research).revision);
  const setup = resolveSetup(store, research);
  assert.deepEqual(setup.extensionPaths, [bundled]);
  assert.deepEqual(setup.skillDirs, [dirname(sharedSkill), dirname(local), dirname(companion)]);
  assert.deepEqual(setup.mcpServers, { catalog: { url: "https://example.com/mcp" } });
  assert.deepEqual(resolveSetup(store, defaultAgent).extensionPaths, []);
  const beforeSharedEdit = resolveSetup(store, defaultAgent).fingerprint;
  await writeFile(sharedSkill, skill("guide") + "Updated shared skill.\n");
  assert.notEqual(resolveSetup(store, research).fingerprint, setup.fingerprint);
  assert.equal(resolveSetup(store, defaultAgent).fingerprint, beforeSharedEdit);

  const child = { agent: store.create({ name: "Child", base: [id] }).id };
  assert.ok(resolveSetup(store, child).skillDirs.includes(dirname(local)));
  store.setSwitch(child.agent, "extension:research", false);
  assert.deepEqual(resolveSetup(store, child).extensionPaths, []);
  assert.ok(!resolveSetup(store, child).skillDirs.includes(dirname(companion)));
  assert.deepEqual(resolveSetup(store, research).extensionPaths, [bundled]);

  await rm(bundled);
  const missing = resolveSetup(store, research);
  assert.deepEqual(missing.extensionPaths, []);
  assert.ok(missing.items.find(item => item.name === "research")?.unavailable);
  assert.ok(!missing.skillDirs.includes(dirname(companion)));
  store.select(research, "extensions", "shared:research", true, store.read(research).revision);
  assert.deepEqual(resolveSetup(store, research).extensionPaths, [shared]);
  store.select(research, "extensions", "shared:research", false, store.read(research).revision);
  assert.deepEqual(resolveSetup(store, research).extensionPaths, []);
  assert.ok(await readFile(shared, "utf8"));
});

test("migration preserves resolved setup, backs up definitions and can be repeated", async (t) => {
  const { root, store, put } = await fixture(t);
  const named = { agent: "author" };
  const session = { session: "b666f724-2b98-4a39-81c3-787339d794c3" };
  const original = '{ "name": "Author", "off": ["skill:unused"], "mcpServers": {"jira":{"url":"https://example.com"}} }\n';
  const override = '{ "base": ["author"], "off": ["instruction:tone"] }\n';
  const definition = await put("agents/author/agent.json", original);
  await put("agents/author/instructions/tone.md", "Use active voice.");
  await put("agents/author/skills/unused/SKILL.md", skill("unused"));
  const layer = await put("sessions/" + session.session + "/agent/agent.json", override);
  await put("sessions/" + session.session + "/agent/prompts/review.md", "Review this.");
  const before = [named, session].map((target) => resolveSetup(store, target).fingerprint);

  assert.deepEqual(migrateAgentResources(store, false), { definitions: 3, pending: 2, converted: 0 });
  assert.equal(await readFile(definition, "utf8"), original);
  const converted = migrateAgentResources(store, true);
  assert.equal(converted.converted, 2);
  assert.deepEqual([named, session].map((target) => resolveSetup(store, target).fingerprint), before);
  assert.deepEqual(store.read(named).definition.resources, {
    instructions: ["local:tone"], skills: ["local:unused"], mcp: ["local:jira"],
  });
  assert.deepEqual(store.read(session).definition.resources, { prompts: ["local:review"] });
  assert.equal(await readFile(join(root, converted.backup!, "agents/author/agent.json"), "utf8"), original);
  assert.equal(await readFile(join(root, converted.backup!, "sessions", session.session, "agent/agent.json"), "utf8"), override);
  assert.notEqual(await readFile(layer, "utf8"), override);
  assert.deepEqual(migrateAgentResources(store, true), { definitions: 3, pending: 0, converted: 0 });
});

test("a failed conversion restores definitions it already rewrote", async (t) => {
  const { store, put } = await fixture(t);
  const original = (name: string) => JSON.stringify({ name }) + "\n";
  const first = await put("agents/alpha/agent.json", original("Alpha"));
  const second = await put("agents/beta/agent.json", original("Beta"));
  const save = store.save.bind(store);
  const attempt = t.mock.method(store, "save", (...args: Parameters<AgentStore["save"]>) => {
    const [target] = args;
    if ("agent" in target && target.agent === "beta") throw new Error("fixture write failure");
    return save(...args);
  });
  assert.throws(() => migrateAgentResources(store, true), /migration failed/);
  assert.equal(await readFile(first, "utf8"), original("Alpha"));
  assert.equal(await readFile(second, "utf8"), original("Beta"));
  attempt.mock.restore();
  assert.equal(migrateAgentResources(store, true).converted, 2);
});
