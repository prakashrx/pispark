import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PersonaStore } from "../src/core/personas/store.js";
import {
  bindingOf,
  checkCycles,
  listPersonas,
  resolveSetup,
  viewPersona,
} from "../src/core/personas/resolve.js";
import {
  DEFAULT_TOOLS,
  frontmatter,
  PersonaError,
  slug,
  validateDefinition,
} from "../src/core/personas/format.js";
import { testHome } from "./fixtures/home.js";

const code = (expected: string) => (error: unknown) =>
  error instanceof PersonaError && error.code === expected;
const CHAT = "11111111-1111-4111-8111-111111111111";

async function store() {
  const h = await testHome("pispark-personas-");
  const s = new PersonaStore(
    join(h.home, "personas"),
    join(h.home, "chats"),
    () => "dev",
  );
  // The store watches its folder; stop watching before the folder is removed.
  return { ...h, store: s, remove: async () => { await s.shutdown(); await h.remove(); } };
}

test("first start creates a Default persona with Pi's built-in tools", async (t) => {
  const { store: s, home, remove } = await store();
  t.after(remove);
  const saved = JSON.parse(
    readFileSync(join(home, "personas", "default", "persona.json"), "utf8"),
  );
  assert.equal(saved.name, "Default");
  assert.deepEqual(saved.on, DEFAULT_TOOLS.map((tool) => `tool:${tool}`));
  const setup = resolveSetup(s, { persona: "default" });
  assert.deepEqual(setup.toolsOn, [...DEFAULT_TOOLS]);
  assert.deepEqual(setup.layers, [{ id: "default", name: "Default" }]);
  assert.equal(s.list()[0]!.builtIn, true);
});

test("readable slug IDs, revision-checked saves, delete rules", async (t) => {
  const { store: s, remove } = await store();
  t.after(remove);
  assert.equal(slug("My Dev Helper!", () => false), "my-dev-helper");
  assert.equal(slug("Default", () => false), "default-2");
  const dev = s.create({ name: "Dev" });
  assert.equal(dev.id, "dev");
  assert.equal(s.create({ name: "Dev" }).id, "dev-2");
  const saved = s.save(
    { persona: "dev" },
    dev.revision,
    { name: "Dev", description: "Coding" },
  );
  assert.throws(
    () => s.save({ persona: "dev" }, dev.revision, { name: "Stale" }),
    code("revision-conflict"),
  );
  assert.equal(s.read({ persona: "dev" }).revision, saved.revision);
  s.create({ name: "Child", base: ["dev"] });
  assert.throws(() => s.remove("dev"), code("in-use"));
  assert.throws(() => s.remove("default"), code("built-in"));
  s.remove("child");
  s.remove("dev");
  assert.equal(s.exists({ persona: "dev" }), false);
  assert.throws(() => s.create({ name: "X", base: ["nope"] }), code("missing-parent"));
});

test("frontmatter reads plain, quoted, folded and literal values", () => {
  const { data, body } = frontmatter(
    "---\nname: review\ndescription: >-\n  Split work into\n  small PRs.\nnote: |\n  line one\n  line two\nquoted: \"hi\"\n---\nBody",
  );
  assert.deepEqual(data, {
    name: "review",
    description: "Split work into small PRs.",
    note: "line one\nline two",
    quoted: "hi",
  });
  assert.equal(body, "Body");
});

test("the format is strict: unknown keys, bad switches and Default as a parent are refused", () => {
  for (const bad of [
    { name: "A", tools: ["read"] },
    { name: "A", base: ["default"] },
    { name: "A", off: ["skill"] },
    { name: "A", on: ["tool:x"], off: ["tool:x"] },
    { name: "A", settings: { temperature: 1 } },
    { name: " padded " },
    {},
  ])
    assert.throws(() => validateDefinition(bad), code("invalid-definition"));
  assert.deepEqual(validateDefinition({ base: ["dev"] }, { chatLayer: true }), {
    base: ["dev"],
  });
});

test("resolution: Default first, diamond parents once, later layers win, off and back on", async (t) => {
  const { store: s, persona, remove } = await store();
  t.after(remove);
  await persona(
    "default",
    { name: "Default", on: ["tool:read", "tool:bash"] },
    { "instructions/tone.md": "Be friendly." },
  );
  await persona(
    "dev",
    { name: "Dev", off: ["instruction:tone", "tool:bash"] },
    { "skills/review/SKILL.md": "---\nname: review\ndescription: Review code\n---\nSteps" },
  );
  await persona(
    "writer",
    { name: "Writer", settings: { thinking: "low" } },
    { "prompts/outline.md": "---\ndescription: Outline a piece\n---\nOutline $1" },
  );
  await persona("mine", { name: "Mine", base: ["dev", "writer"] });
  const setup = resolveSetup(s, { persona: "mine" });
  assert.deepEqual(
    setup.layers.map((l) => l.id),
    ["default", "dev", "writer", "mine"],
  );
  // Writer doesn't re-apply Default, so Dev's off holds.
  const tone = setup.items.find((i) => i.name === "tone")!;
  assert.equal(tone.on, false);
  assert.deepEqual(tone.switchedBy, { id: "dev", name: "Dev" });
  assert.deepEqual(setup.instructions, []);
  assert.deepEqual(setup.toolsOn, ["read"]);
  assert.ok(setup.toolsOff.includes("bash"));
  assert.equal(setup.skillDirs.length, 1);
  assert.equal(setup.prompts[0]!.name, "outline");
  assert.equal(setup.prompts[0]!.description, "Outline a piece");
  assert.equal(setup.settings.thinking, "low");

  // Turning it back on, and replacing an inherited item by name.
  await persona(
    "mine",
    { name: "Mine", base: ["dev", "writer"], on: ["instruction:tone", "tool:bash"] },
    { "skills/review/SKILL.md": "---\nname: review\n---\nMy steps" },
  );
  const again = resolveSetup(s, { persona: "mine" });
  assert.deepEqual(again.instructions, [{ name: "tone", text: "Be friendly." }]);
  assert.deepEqual(again.toolsOn, ["read", "bash"]);
  const review = again.items.find((i) => i.name === "review")!;
  assert.deepEqual(review.origin, { id: "mine", name: "Mine" });
  assert.deepEqual(review.replaced, [{ id: "dev", name: "Dev" }]);
  assert.notEqual(again.fingerprint, setup.fingerprint);
});

test("fingerprints follow content; cycles are refused; a missing parent is reported in the view", async (t) => {
  const { store: s, persona, home, remove } = await store();
  t.after(remove);
  await persona("dev", { name: "Dev" }, { "instructions/a.md": "one" });
  const first = resolveSetup(s, { persona: "dev" }).fingerprint;
  assert.equal(resolveSetup(s, { persona: "dev" }).fingerprint, first);
  await writeFile(join(home, "personas", "dev", "instructions", "a.md"), "two");
  assert.notEqual(resolveSetup(s, { persona: "dev" }).fingerprint, first);

  await persona("a", { name: "A", base: ["b"] });
  await persona("b", { name: "B" });
  assert.throws(
    () => checkCycles(s, { persona: "b" }, { name: "B", base: ["a"] }),
    code("cycle"),
  );
  assert.throws(
    () => s.save({ persona: "a" }, s.read({ persona: "a" }).revision, { name: "A", base: ["a"] }),
    code("cycle"),
  );
  await persona("orphan", { name: "Orphan", base: ["gone"] });
  const view = viewPersona(s, { persona: "orphan" });
  assert.equal(view.error, "missing-parent");
  assert.equal(view.detail, "gone");
  assert.throws(() => resolveSetup(s, { persona: "orphan" }), code("missing-parent"));
});

test("item files: create, revision-checked replace, path rules, skill folders delete whole", async (t) => {
  const { store: s, home, remove } = await store();
  t.after(remove);
  s.create({ name: "Dev" });
  const target = { persona: "dev" };
  const created = s.writeFile(target, "instructions/tone.md", null, "Short.");
  assert.throws(
    () => s.writeFile(target, "instructions/tone.md", null, "again"),
    code("revision-conflict"),
  );
  const replaced = s.writeFile(target, "instructions/tone.md", created.revision, "Shorter.");
  assert.equal(s.readFile(target, "instructions/tone.md").text, "Shorter.");
  for (const bad of ["../x.md", "instructions/a/b.md", "skills/x/run.sh", "persona.json", "instructions/.hidden.md"])
    assert.throws(() => s.readFile(target, bad), code("invalid-path"));
  const skill = s.writeFile(target, "skills/review/SKILL.md", null, "---\nname: review\n---\n");
  await mkdir(join(home, "personas", "dev", "skills", "review", "scripts"));
  s.deleteFile(target, "skills/review/SKILL.md", skill.revision);
  assert.equal(existsSync(join(home, "personas", "dev", "skills", "review")), false);
  s.deleteFile(target, "instructions/tone.md", replaced.revision);
  assert.equal(resolveSetup(s, target).items.length, 0);
});

test("chat layers: a chat reads its persona until edited, then layers on top without changing it", async (t) => {
  const { store: s, persona, remove } = await store();
  t.after(remove);
  await persona("dev", { name: "Dev" }, { "instructions/a.md": "persona" });
  const chat = { chat: CHAT };
  assert.equal(s.exists(chat), false);
  assert.deepEqual(s.read(chat), { definition: { base: ["dev"] }, revision: "" });
  assert.equal(resolveSetup(s, chat).fingerprint, resolveSetup(s, { persona: "dev" }).fingerprint);
  const changes: unknown[] = [];
  s.onChange((target) => changes.push(target));
  s.writeFile(chat, "instructions/b.md", null, "chat only");
  assert.equal(s.exists(chat), true);
  const setup = resolveSetup(s, chat);
  assert.deepEqual(setup.layers.map((l) => l.id), ["default", "dev", "chat"]);
  assert.deepEqual(setup.instructions.map((i) => i.text), ["persona", "chat only"]);
  assert.deepEqual(resolveSetup(s, { persona: "dev" }).instructions.map((i) => i.text), ["persona"]);
  assert.ok(changes.length >= 1);
});

test("a chat on Default gets a layer with no listed parents", async (t) => {
  const h = await testHome("pispark-personas-");
  const s = new PersonaStore(join(h.home, "personas"), join(h.home, "chats"), () => "default");
  t.after(async () => { await s.shutdown(); await h.remove(); });
  const chat = { chat: CHAT };
  assert.deepEqual(s.read(chat), { definition: {}, revision: "" });
  assert.equal(resolveSetup(s, chat).fingerprint, resolveSetup(s, { persona: "default" }).fingerprint);
  s.save(chat, "", { off: ["tool:bash"] });
  const setup = resolveSetup(s, chat);
  assert.deepEqual(setup.layers.map((l) => l.id), ["default", "chat"]);
  assert.ok(!setup.toolsOn.includes("bash"));
  assert.ok(resolveSetup(s, { persona: "default" }).toolsOn.includes("bash"));
});

test("a working folder: absolute, inherited from the nearest layer, not for Default or a chat's own layer, checked when it is set", async (t) => {
  const { store: s, persona, folder, remove } = await store();
  t.after(remove);
  const project = await folder("project");
  const other = await folder("other");
  for (const bad of [{ name: "A", folder: "relative/path" }, { name: "A", folder: "" }, { name: "A", folder: 3 }])
    assert.throws(() => validateDefinition(bad), code("invalid-definition"));
  assert.throws(() => validateDefinition({ base: ["dev"], folder: project }, { chatLayer: true }), code("invalid-definition"));

  await persona("role", { name: "Role" });
  await persona("project", { name: "Project", base: ["role"], folder: project });
  await persona("reviewer", { name: "Reviewer", base: ["project"] });
  await persona("moved", { name: "Moved", base: ["project"], folder: other });
  const setup = (id: string) => resolveSetup(s, { persona: id });
  assert.equal(setup("role").folder, undefined);
  assert.equal(setup("project").folder, project);
  assert.equal(viewPersona(s, { persona: "reviewer" }).folder, project);
  assert.equal(bindingOf(s, { persona: "moved" }).folder, other);
  assert.deepEqual(
    listPersonas(s).map((summary) => [summary.id, summary.folder]),
    [["default", undefined], ["moved", other], ["project", project], ["reviewer", project], ["role", undefined]],
  );
  // A project persona's sessions read their folder's AGENTS.md: becoming one changes the setup, which folder does not.
  assert.notEqual(setup("project").fingerprint, setup("role").fingerprint);
  assert.equal(setup("moved").fingerprint, setup("project").fingerprint);

  // The folder must be there when it is set. One that has since gone does not stop other edits.
  const role = s.read({ persona: "role" });
  assert.throws(() => s.save({ persona: "role" }, role.revision, { name: "Role", folder: join(project, "missing") }), code("folder"));
  s.save({ persona: "role" }, role.revision, { name: "Role", folder: project });
  assert.equal(setup("role").folder, project);
  await rm(other, { recursive: true });
  const moved = s.read({ persona: "moved" });
  s.save({ persona: "moved" }, moved.revision, { ...moved.definition, description: "Still editable" });
  // Every persona builds on Default, so it names none.
  const base = s.read({ persona: "default" });
  assert.throws(() => s.save({ persona: "default" }, base.revision, { ...base.definition, folder: project }), code("invalid-definition"));
});

test("a home view: a view key, inherited from the nearest layer, not for Default or a chat's own layer, and no part of the setup", async (t) => {
  const { store: s, persona, remove } = await store();
  t.after(remove);
  for (const bad of [{ name: "A", home: "two words" }, { name: "A", home: "" }, { name: "A", home: 3 }, { name: "A", home: "x".repeat(65) }])
    assert.throws(() => validateDefinition(bad), code("invalid-definition"));
  assert.throws(() => validateDefinition({ base: ["dev"], home: "desk" }, { chatLayer: true }), code("invalid-definition"));

  await persona("role", { name: "Role" });
  await persona("app", { name: "App", base: ["role"], home: "desk" });
  await persona("variant", { name: "Variant", base: ["app"] });
  await persona("other", { name: "Other", base: ["app"], home: "board" });
  assert.deepEqual(bindingOf(s, { persona: "role" }), {});
  assert.deepEqual(bindingOf(s, { persona: "variant" }), { home: "desk" });
  assert.equal(viewPersona(s, { persona: "other" }).home, "board");
  assert.deepEqual(
    listPersonas(s).map((summary) => [summary.id, summary.home]),
    [["default", undefined], ["app", "desk"], ["other", "board"], ["role", undefined], ["variant", "desk"]],
  );
  // Which view shows first is the client's business: the agent's setup is the same.
  assert.equal(resolveSetup(s, { persona: "app" }).fingerprint, resolveSetup(s, { persona: "role" }).fingerprint);
  const base = s.read({ persona: "default" });
  assert.throws(() => s.save({ persona: "default" }, base.revision, { ...base.definition, home: "desk" }), code("invalid-definition"));
});
