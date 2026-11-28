import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentStore } from "../src/core/agents/store.js";
import { resolveSetup, viewAgent } from "../src/core/agents/resolve.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pispark-library-"));
  await mkdir(join(root, "sessions"));
  const store = new AgentStore(join(root, "agents"), join(root, "sessions"), () => "default", undefined, join(root, "app", "plugins"));
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
  const select = (agent: string, type: "skills" | "instructions" | "extensions", reference: string) =>
    store.select({ agent }, type, reference as never, true, store.read({ agent }).revision);
  return { root, store, put, select };
}

const skill = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`;

test("shared and bundled items can be read where they live; a shared one says how many agents use it", async (t) => {
  const { store, put, select } = await fixture(t);
  await put("resources/skills/guide/SKILL.md", skill("guide"));
  await put("resources/skills/guide/references/style.md", "Style.");
  await put("resources/skills/guide/scripts/check.sh", "echo ok");
  await put("resources/skills/guide/.cache/x", "hidden");
  await put("app/plugins/skills/tour/SKILL.md", skill("tour"));
  const a = store.create({ name: "A" }).id;
  const b = store.create({ name: "B" }).id;
  select(a, "skills", "shared:guide");
  select(b, "skills", "shared:guide");
  select(a, "skills", "bundled:tour");

  const items = viewAgent(store, { agent: a }).items;
  const guide = items.find((item) => item.name === "guide")!;
  assert.deepEqual([guide.path, guide.usedBy, guide.files], ["skills/guide/SKILL.md", 2, ["references/style.md", "scripts/check.sh"]]);
  const tour = items.find((item) => item.name === "tour")!;
  assert.deepEqual([tour.path, tour.usedBy], ["skills/tour/SKILL.md", undefined]);
  assert.equal(store.available({ agent: a }, "skills").find((entry) => entry.reference === "shared:guide")?.usedBy, 2);

  const shared = { library: "shared" as const };
  assert.match(store.readFile(shared, "skills/guide/SKILL.md").text, /# guide/);
  assert.equal(store.readFile(shared, "skills/guide/references/style.md").text, "Style.");
  assert.match(store.readFile({ library: "bundled" }, "skills/tour/SKILL.md").text, /# tour/);
  for (const path of [
    "skills/guide/../../agents/a/agent.json",
    "skills/guide/.cache/x",
    "agents/a/agent.json",
    "skills/guide/references\\..\\x",
  ])
    assert.throws(() => store.readFile(shared, path), { code: "invalid-path" }, path);

  // Writing the shared file reaches both agents; the app's own can't be written.
  const { revision } = store.readFile(shared, "skills/guide/SKILL.md");
  store.writeFile(shared, "skills/guide/SKILL.md", revision, skill("guide") + "More.\n");
  assert.throws(() => store.writeFile(shared, "skills/guide/SKILL.md", revision, "stale"), { code: "revision-conflict" });
  assert.throws(() => store.writeFile({ library: "bundled" }, "skills/tour/SKILL.md", null, "x"), { code: "built-in" });
  assert.throws(() => store.writeFile(shared, "skills/guide/references/style.md", null, "x"), { code: "invalid-path" });
  assert.match(store.readFile(shared, "skills/guide/SKILL.md").text, /More\./);
});

test("Move to Shared library moves an agent's own item and keeps it for agents built on it", async (t) => {
  const { root, store, put, select } = await fixture(t);
  const owner = store.create({ name: "Owner" }).id;
  const child = store.create({ name: "Child", base: [owner] }).id;
  store.writeFile({ agent: owner }, "skills/notes/SKILL.md", null, skill("notes"));
  await put(`agents/${owner}/skills/notes/references/more.md`, "More.");
  store.writeFile({ agent: owner }, "instructions/tone.md", null, "Be brief.");
  await put(`agents/${owner}/extensions/alerts/index.ts`, "export default () => {};\n");
  select(owner, "extensions", "local:alerts");

  const promote = (type: "skills" | "instructions" | "extensions", name: string) =>
    store.promote({ agent: owner }, type, name, store.read({ agent: owner }).revision);
  promote("skills", "notes");
  promote("instructions", "tone");
  promote("extensions", "alerts");
  assert.deepEqual(store.read({ agent: owner }).definition.resources, {
    skills: ["shared:notes"],
    instructions: ["shared:tone"],
    extensions: ["shared:alerts"],
  });
  assert.equal(await readFile(join(root, "resources/skills/notes/references/more.md"), "utf8"), "More.");
  assert.ok(existsSync(join(root, "resources/instructions/tone.md")));
  assert.ok(existsSync(join(root, "resources/extensions/alerts/index.ts")));
  assert.ok(!existsSync(join(root, `agents/${owner}/skills/notes`)));
  assert.deepEqual(resolveSetup(store, { agent: child }).skillDirs, [join(root, "resources/skills/notes")]);
  assert.deepEqual(
    resolveSetup(store, { agent: child }).instructions.map((i) => i.text),
    ["Be brief."],
  );

  // A name already in the library, a stale revision, or something not its own is refused.
  store.writeFile({ agent: owner }, "skills/notes/SKILL.md", null, skill("notes"));
  assert.throws(() => promote("skills", "notes"), { code: "exists" });
  assert.ok(store.read({ agent: owner }).definition.resources?.skills?.includes("local:notes"));
  assert.throws(() => store.promote({ agent: owner }, "skills", "notes", "0".repeat(64)), { code: "revision-conflict" });
  assert.throws(() => promote("skills", "missing"), { code: "not-found" });
});

test("instructions follow the order the agent lists them in", async (t) => {
  const { store } = await fixture(t);
  const id = store.create({ name: "Writer" }).id;
  store.writeFile({ agent: id }, "instructions/first.md", null, "One.");
  store.writeFile({ agent: id }, "instructions/second.md", null, "Two.");
  assert.deepEqual(
    resolveSetup(store, { agent: id }).instructions.map((i) => i.name),
    ["first", "second"],
  );
  const { definition, revision } = store.read({ agent: id });
  store.save({ agent: id }, revision, {
    ...definition,
    resources: { ...definition.resources, instructions: ["local:second", "local:first"] },
  });
  assert.deepEqual(
    resolveSetup(store, { agent: id }).instructions.map((i) => i.name),
    ["second", "first"],
  );
});

test("making a shared or bundled item this agent's own copies it whole, scripts and references too", async (t) => {
  const { root, store, put, select } = await fixture(t);
  await put("resources/skills/guide/SKILL.md", skill("guide"));
  await put("resources/skills/guide/references/style.md", "Style.");
  await put("app/plugins/extensions/notify/index.ts", "export default () => {};\n");
  await put("app/plugins/extensions/notify/helper.ts", "export const x = 1;\n");
  const id = store.create({ name: "Mine" }).id;
  select(id, "skills", "shared:guide");
  const copy = (type: "skills" | "extensions", name: string, from: { library: "shared" | "bundled" }) =>
    store.copyIn({ agent: id }, type, name, from, store.read({ agent: id }).revision);

  copy("skills", "guide", { library: "shared" });
  copy("extensions", "notify", { library: "bundled" });
  assert.deepEqual(store.read({ agent: id }).definition.resources, { skills: ["local:guide"], extensions: ["local:notify"] });
  assert.equal(await readFile(join(root, `agents/${id}/skills/guide/references/style.md`), "utf8"), "Style.");
  assert.ok(existsSync(join(root, `agents/${id}/extensions/notify/helper.ts`)));
  assert.equal(await readFile(join(root, "resources/skills/guide/references/style.md"), "utf8"), "Style.", "the original stays");
  assert.deepEqual(resolveSetup(store, { agent: id }).skillDirs, [join(root, `agents/${id}/skills/guide`)]);

  assert.throws(() => copy("skills", "guide", { library: "shared" }), { code: "exists" });
  assert.throws(() => copy("skills", "missing", { library: "shared" }), { code: "not-found" });
  assert.throws(() => store.copyIn({ agent: id }, "skills", "guide", { library: "shared" }, "0".repeat(64)), { code: "exists" });
});
