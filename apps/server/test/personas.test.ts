import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { PersonaStore } from "../src/personas/store.js";
import { resolvePersona, publicView } from "../src/personas/resolver.js";
import {
  definition,
  hash,
  PersonaError,
  relativePath,
} from "../src/personas/schema.js";
import type { PersonaDefinition } from "../src/persona-protocol.js";
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "pispark-personas-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const managed = join(root, "managed"),
    external = join(root, "external");
  mkdirSync(external);
  const store = new PersonaStore(managed, { examples: external });
  const add = (
    name: string,
    fields: Partial<PersonaDefinition> = {},
    outside = false,
  ) => {
    const id = randomUUID(),
      directory = join(outside ? external : managed, id);
    mkdirSync(directory);
    const ref = { root: outside ? "examples" : "managed", path: id, id };
    writeFileSync(
      join(directory, "persona.json"),
      JSON.stringify({ schemaVersion: 1, id, name, ...fields }),
    );
    return { ref, directory };
  };
  return { root, managed, external, store, add };
}
const error = (code: string) => (e: unknown) =>
  e instanceof PersonaError && e.code === code;

test("store creates stable UUID folders, revisions, atomic stale writes and independent own-file saves", async (t) => {
  const { store, managed } = fixture(t);
  const created = await store.create({ schemaVersion: 1, name: "Writer" });
  assert.equal(created.ref.path, created.ref.id);
  const saved = await store.save(created.ref, created.revision, {
    ...created.definition,
    name: "Renamed",
  });
  assert.equal(saved.ref.id, created.ref.id);
  await assert.rejects(
    store.save(created.ref, created.revision, created.definition),
    error("revision-conflict"),
  );
  const file = await store.saveInstruction(
    saved.ref,
    "rules/a.md",
    null,
    "File instructions",
  );
  const withFile = await store.save(saved.ref, saved.revision, {
    ...saved.definition,
    instructions: [{ id: "first", file: "rules/a.md" }],
  });
  assert.equal(
    store.instruction(saved.ref, "rules/a.md").text,
    "File instructions",
  );
  const updated = await store.saveInstruction(
    saved.ref,
    "rules/a.md",
    file.fileRevision,
    "Changed",
  );
  assert.notEqual(updated.revision, withFile.revision);
  await assert.rejects(
    store.save(saved.ref, withFile.revision, withFile.definition),
    error("revision-conflict"),
  );
  await assert.rejects(
    store.saveInstruction(saved.ref, "rules/a.md", file.fileRevision, "stale"),
    error("revision-conflict"),
  );
  assert.equal(new PersonaStore(managed).list()[0]?.name, "Renamed");
  assert(
    !readdirSync(join(managed, saved.ref.id)).some((p) => /tmp|lock/.test(p)),
  );
});

test("schema exactness, path syntax, read-only ownership and safe diagnostics", async (t) => {
  const { store, add } = fixture(t);
  for (const fields of [
    { extensions: [] },
    { instructions: [{ id: "a", text: "a", file: "a.md" }] },
    { schemaVersion: 2 },
    { parents: [null] },
    { exclude: { skills: ["a", "a"] } },
  ])
    assert.throws(() =>
      definition({ schemaVersion: 1, id: randomUUID(), name: "A", ...fields }),
    );
  for (const path of [
    "/etc/a",
    "C:/a",
    "../a",
    "a//b",
    "a\\b",
    "a:stream",
    "a/..",
    "a/CON",
    "a%2fb",
  ])
    assert.throws(() => relativePath(path, true));
  const outside = add("External", {}, true),
    original = readFileSync(join(outside.directory, "persona.json"));
  const view = resolvePersona(store, outside.ref);
  await assert.rejects(
    store.save(outside.ref, view.revision, {
      ...view.definition,
      name: "Not allowed",
    }),
    error("read-only"),
  );
  await assert.rejects(
    store.saveInstruction(outside.ref, "a.md", null, "No"),
    error("read-only"),
  );
  assert.deepEqual(
    readFileSync(join(outside.directory, "persona.json")),
    original,
  );
  writeFileSync(join(outside.directory, "persona.json"), '{"id":"SECRET"}');
  assert(!JSON.stringify(store.list()).includes("SECRET"));
});

test("ordered composition, diamond deduplication, explicit divergent overrides and include/exclude", (t) => {
  const { store, add } = fixture(t);
  const a = add("A", {
    instructions: [
      { id: "tone", text: "Base" },
      { id: "end", text: "End" },
    ],
  });
  const b = add("B", { parents: [a.ref] });
  const c = add("C", { parents: [a.ref] });
  const d = add("D", {
    parents: [b.ref, c.ref],
    instructions: [{ id: "tail", text: "Tail" }],
  });
  const result = resolvePersona(store, d.ref);
  assert.deepEqual(
    result.instructions.map((r) => r.id),
    ["tone", "end", "tail"],
  );
  assert.equal(result.instructions[0]?.routes.length, 3);
  assert.equal(result.revision, resolvePersona(store, d.ref).revision);
  const changed = {
    ...store.read(c.ref).definition,
    instructions: [{ id: "tone", text: "Branch", replace: true as const }],
  };
  writeFileSync(join(c.directory, "persona.json"), JSON.stringify(changed));
  assert.throws(() => resolvePersona(store, d.ref), error("resource-conflict"));
  const overridden = resolvePersona(store, d.ref, {
    ...store.read(d.ref).definition,
    instructions: [
      { id: "tail", text: "Tail" },
      { id: "tone", text: "Join", replace: true },
    ],
  });
  assert.deepEqual(
    overridden.instructions.map((r) => r.id),
    ["tone", "end", "tail"],
  );
  assert.equal(overridden.instructions[0]?.text, "Join");
  const filtered = resolvePersona(store, d.ref, {
    ...store.read(d.ref).definition,
    parents: [{ ...b.ref, include: { instructions: [] } }, c.ref],
    exclude: { instructions: ["end"] },
    instructions: [],
  });
  assert.deepEqual(
    filtered.instructions.map((r) => r.text),
    ["Branch"],
  );
  assert.equal(filtered.excluded[0]?.id, "end");
  assert.throws(
    () =>
      resolvePersona(store, d.ref, {
        ...store.read(d.ref).definition,
        exclude: { instructions: ["typo"] },
      }),
    error("unknown-selection"),
  );
});

test("declaring-root file instructions, complete native skill trees, stable hashes and changed-input detection", (t) => {
  const { store, add } = fixture(t);
  const base = add("Base", {
    instructions: [{ id: "file", file: "rule.md" }],
    skills: [{ id: "review", directory: "review" }],
  });
  writeFileSync(join(base.directory, "rule.md"), "Upstream rule");
  mkdirSync(join(base.directory, "review", "references"), { recursive: true });
  writeFileSync(
    join(base.directory, "review", "SKILL.md"),
    "---\nname: review\ndescription: Review work\n---\nRead references/check.md",
  );
  writeFileSync(
    join(base.directory, "review", "references", "check.md"),
    "Support",
  );
  writeFileSync(join(base.directory, "review", ".hidden"), "Hidden support");
  const child = add("Child", { parents: [base.ref] });
  const result = resolvePersona(store, child.ref);
  assert.equal(result.instructions[0]?.text, "Upstream rule");
  assert.equal(result.skills[0]?.nativeName, "review");
  assert.equal(result.skills[0]?.manifest?.length, 3);
  assert(!JSON.stringify(publicView(result)).includes(base.directory));
  assert.equal(hash({ b: 2, a: 1 }), hash({ a: 1, b: 2 }));
  writeFileSync(
    join(base.directory, "review", "references", "check.md"),
    "Changed",
  );
  assert.throws(result.verify, error("resource-changed"));
  assert.notEqual(resolvePersona(store, child.ref).revision, result.revision);
});

test("cycles, duplicate identity, native collisions and symlinks fail closed", (t) => {
  const { store, add, root } = fixture(t);
  const a = add("A"),
    b = add("B", { parents: [a.ref] });
  writeFileSync(
    join(a.directory, "persona.json"),
    JSON.stringify({ ...store.read(a.ref).definition, parents: [b.ref] }),
  );
  assert.throws(() => resolvePersona(store, a.ref), error("cycle"));
  writeFileSync(
    join(a.directory, "persona.json"),
    JSON.stringify({
      ...store.read(a.ref).definition,
      parents: [],
      instructions: [{ id: "bad", file: "linked.md" }],
    }),
  );
  writeFileSync(join(root, "outside.md"), "PRIVATE");
  symlinkSync(join(root, "outside.md"), join(a.directory, "linked.md"));
  assert.throws(() => resolvePersona(store, a.ref), error("symlink"));
  const duplicate = add("Duplicate");
  writeFileSync(
    join(duplicate.directory, "persona.json"),
    JSON.stringify({ schemaVersion: 1, id: b.ref.id, name: "Duplicate" }),
  );
  assert.throws(
    () => resolvePersona(store, b.ref),
    error("duplicate-identity"),
  );
});
