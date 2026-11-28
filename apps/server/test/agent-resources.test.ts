import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentStore } from "../src/core/agents/store.js";
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

  assert.deepEqual(
    store.available(research, "extensions").map(({ reference }) => reference),
    ["bundled:research", "shared:research"],
  );
  assert.deepEqual(
    store.available(research, "skills").map(({ reference }) => reference),
    ["shared:guide", "local:private-note"],
  );
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
  assert.ok(missing.items.find((item) => item.name === "research")?.unavailable);
  assert.ok(!missing.skillDirs.includes(dirname(companion)));
  store.select(research, "extensions", "shared:research", true, store.read(research).revision);
  assert.deepEqual(resolveSetup(store, research).extensionPaths, [shared]);
  store.select(research, "extensions", "shared:research", false, store.read(research).revision);
  assert.deepEqual(resolveSetup(store, research).extensionPaths, []);
  assert.ok(await readFile(shared, "utf8"));
});
