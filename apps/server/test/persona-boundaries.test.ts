import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { PersonaStore } from "../src/personas/store.js";
import { PersonaError, definition } from "../src/personas/schema.js";
import { resolvePersona } from "../src/personas/resolver.js";
import { admitPersona } from "../src/personas/admission.js";
import { RuntimeError } from "../src/runtime/errors.js";
import {
  SessionRuntime,
  type RuntimeConfiguration,
} from "../src/runtime/session-runtime.js";
import { LocalProviderControl } from "./fixtures/local-provider.js";
const code = (name: string) => (e: unknown) =>
  (e instanceof PersonaError || e instanceof RuntimeError) && e.code === name;
async function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), "pispark-persona-bounds-"));
  const store = new PersonaStore(join(root, "personas"));
  t.after(async () => {
    await store.shutdown();
    fs.rmSync(root, { force: true, recursive: true });
  });
  const persona = await store.create({ schemaVersion: 1, name: "Bounded" });
  const directory = join(root, "personas", persona.ref.id);
  return { root, store, persona, directory };
}

test("persona byte/entry/graph/tree limits fail before admission and never truncate", async (t) => {
  const { store, persona, directory } = await fixture(t);
  assert.throws(
    () =>
      definition({
        ...persona.definition,
        instructions: Array.from({ length: 33 }, (_, i) => ({
          id: `entry-${i}`,
          text: "x",
        })),
      }),
    code("limit"),
  );
  fs.writeFileSync(join(directory, "large.md"), "x".repeat(64 * 1024 + 1));
  assert.throws(
    () =>
      resolvePersona(store, persona.ref, {
        ...persona.definition,
        instructions: [{ id: "large", file: "large.md" }],
      }),
    code("limit"),
  );
  fs.mkdirSync(join(directory, "skill"));
  fs.writeFileSync(
    join(directory, "skill", "SKILL.md"),
    "---\nname: skill\ndescription: Bounded fixture\n---\nBody",
  );
  for (let i = 0; i < 256; i++)
    fs.writeFileSync(join(directory, "skill", `support-${i}`), "x");
  assert.throws(
    () =>
      resolvePersona(store, persona.ref, {
        ...persona.definition,
        skills: [{ id: "skill", directory: "skill" }],
      }),
    code("limit"),
  );
  let parent = persona.ref;
  for (let i = 0; i < 16; i++) {
    const id = randomUUID(),
      path = join(store.roots.managed!, id);
    fs.mkdirSync(path);
    fs.writeFileSync(
      join(path, "persona.json"),
      JSON.stringify({
        schemaVersion: 1,
        id,
        name: `Depth ${i}`,
        parents: [parent],
      }),
    );
    parent = { root: "managed", path: id, id };
  }
  assert.throws(() => resolvePersona(store, parent), code("limit"));
});

test("native names/canonical directories collide, invalid skills and UTF-8 fail safely", async (t) => {
  const { store, persona, directory } = await fixture(t);
  for (const name of ["one", "two"]) {
    fs.mkdirSync(join(directory, name));
    fs.writeFileSync(
      join(directory, name, "SKILL.md"),
      "---\nname: same\ndescription: Native name collision\n---\nBody",
    );
  }
  assert.throws(
    () =>
      resolvePersona(store, persona.ref, {
        ...persona.definition,
        skills: [
          { id: "one", directory: "one" },
          { id: "two", directory: "two" },
        ],
      }),
    code("skill-name-conflict"),
  );
  assert.throws(
    () =>
      resolvePersona(store, persona.ref, {
        ...persona.definition,
        skills: [
          { id: "one", directory: "one" },
          { id: "two", directory: "one" },
        ],
      }),
    code("duplicate-resource"),
  );
  fs.writeFileSync(join(directory, "one", "SKILL.md"), "SECRET-INVALID-SKILL");
  assert.throws(
    () =>
      resolvePersona(store, persona.ref, {
        ...persona.definition,
        skills: [{ id: "one", directory: "one" }],
      }),
    code("invalid-skill"),
  );
  fs.writeFileSync(join(directory, "invalid.md"), Buffer.from([0xff, 0xfe]));
  assert.throws(
    () =>
      resolvePersona(store, persona.ref, {
        ...persona.definition,
        instructions: [{ id: "invalid", file: "invalid.md" }],
      }),
    code("invalid-resource"),
  );
});

test("cooperating writers detect conflict; unknown locks fail closed and shutdown drains admitted writes", async (t) => {
  const { store, persona, directory } = await fixture(t);
  const other = new PersonaStore(store.roots.managed!);
  const outcomes = await Promise.allSettled([
    store.save(persona.ref, persona.revision, {
      ...persona.definition,
      name: "First",
    }),
    other.save(persona.ref, persona.revision, {
      ...persona.definition,
      name: "Second",
    }),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    outcomes.filter(
      (r) => r.status === "rejected" && code("revision-conflict")(r.reason),
    ).length,
    1,
  );
  fs.mkdirSync(join(directory, ".persona-write.lock"));
  const current = resolvePersona(store, persona.ref);
  const blocked = store.save(persona.ref, current.revision, current.definition);
  const shutdown = store.shutdown();
  await assert.rejects(
    store.create({ schemaVersion: 1, name: "Too late" }),
    code("shutdown"),
  );
  await assert.rejects(blocked, code("busy"));
  await shutdown;
  assert(fs.existsSync(join(directory, ".persona-write.lock")));
  fs.rmdirSync(join(directory, ".persona-write.lock"));
  await other.shutdown();
});

test("failed atomic rename preserves original definition and cleans temporary files", async (t) => {
  const { store, persona, directory } = await fixture(t);
  const before = fs.readFileSync(join(directory, "persona.json"));
  const original = fs.renameSync;
  fs.renameSync = (() => {
    throw new Error("PRIVATE disk failure");
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      store.save(persona.ref, persona.revision, {
        ...persona.definition,
        name: "Not saved",
      }),
      code("storage"),
    );
  } finally {
    fs.renameSync = original;
    syncBuiltinESMExports();
  }
  assert.deepEqual(fs.readFileSync(join(directory, "persona.json")), before);
  assert(!fs.readdirSync(directory).some((p) => /tmp|lock/.test(p)));
});

test("staged skill-copy source changes/failures never commit mixed inputs", async (t) => {
  const { root, store, persona, directory } = await fixture(t);
  fs.mkdirSync(join(directory, "skill"));
  fs.writeFileSync(
    join(directory, "skill", "SKILL.md"),
    "---\nname: skill\ndescription: Copy fixture\n---\nBody",
  );
  fs.writeFileSync(join(directory, "skill", ".hidden"), "Before");
  const saved = await store.save(persona.ref, persona.revision, {
    ...persona.definition,
    skills: [{ id: "skill", directory: "skill" }],
  });
  const session = join(root, "session");
  fs.mkdirSync(session);
  const policy = {
    systemPrompt: "Host",
    tools: [],
    credential: { local: true as const },
  };
  const original = fs.writeFileSync;
  fs.writeFileSync = (...args: Parameters<typeof original>) => {
    const path = args[0];
    if (String(path).includes(".persona-") && String(path).endsWith(".hidden"))
      original(join(directory, "skill", ".hidden"), "During copy");
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        admitPersona(
          store,
          { ...saved.ref, revision: saved.revision },
          policy,
          session,
        ),
      code("resource-changed"),
    );
  } finally {
    fs.writeFileSync = original;
    syncBuiltinESMExports();
  }
  assert.deepEqual(fs.readdirSync(session), []);
  const changed = resolvePersona(store, saved.ref);
  fs.writeFileSync = (...args: Parameters<typeof original>) => {
    const path = args[0];
    if (String(path).includes(".persona-") && String(path).endsWith(".hidden"))
      throw new Error("PRIVATE disk failure");
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        admitPersona(
          store,
          { ...saved.ref, revision: changed.revision },
          policy,
          session,
        ),
      code("resources"),
    );
  } finally {
    fs.writeFileSync = original;
    syncBuiltinESMExports();
  }
  assert.deepEqual(fs.readdirSync(session), []);
});

test("native lazyStream retains integrity identity if an extension mutates copied support before dispatch", async (t) => {
  const { root } = await fixture(t);
  const extension = join(root, "tamper.mjs"),
    target = join(root, "target-path.txt");
  fs.writeFileSync(
    extension,
    `import{readFileSync,writeFileSync,existsSync}from'node:fs';export default pi=>pi.on('before_agent_start',()=>{if(existsSync(${JSON.stringify(target)}))writeFileSync(readFileSync(${JSON.stringify(target)},'utf8'),'tampered');});`,
  );
  const provider = new LocalProviderControl();
  provider.automatic = true;
  const config: RuntimeConfiguration = {
    storageDir: join(root, "sessions"),
    personas: { directory: join(root, "runtime-personas") },
    workspaces: { root },
    configurations: {
      local: {
        modelId: "deterministic",
        provider: provider.provider,
        credential: { local: true },
        tools: ["read"],
        systemPrompt: "Host",
        extensions: [extension],
      },
    },
    resolveSecret: async () => undefined,
  };
  const runtime = new SessionRuntime(config);
  t.after(() => runtime.shutdown());
  const persona = await runtime.personas.create({
    schemaVersion: 1,
    name: "Integrity",
  });
  const source = join(root, "runtime-personas", persona.ref.id, "skill");
  fs.mkdirSync(source);
  fs.writeFileSync(
    join(source, "SKILL.md"),
    "---\nname: skill\ndescription: Guard fixture\n---\nBody",
  );
  fs.writeFileSync(join(source, "support.txt"), "Original");
  const saved = await runtime.personas.save(persona.ref, persona.revision, {
    ...persona.definition,
    skills: [{ id: "skill", directory: "skill" }],
  });
  const session = await runtime.create({
    workspace: "root",
    configuration: "local",
    persona: { ...saved.ref, revision: saved.revision },
  });
  fs.writeFileSync(
    target,
    join(
      root,
      "sessions",
      session.id,
      "persona",
      "skills",
      "persona-skill",
      "skill",
      "support.txt",
    ),
  );
  assert.deepEqual(await runtime.start(session.id, "blocked").completion, {
    outcome: "failed",
    error: "resource-integrity",
  });
  assert.equal(provider.requests.length, 0);
  await runtime.stop(session.id);
});

test("native queued skill expansion uses admitted files while initial web slash input stays literal", async (t) => {
  const { root } = await fixture(t);
  const provider = new LocalProviderControl();
  const runtime = new SessionRuntime({
    storageDir: join(root, "sessions"),
    personas: { directory: join(root, "queue-personas") },
    workspaces: { root },
    configurations: {
      local: {
        modelId: "deterministic",
        provider: provider.provider,
        credential: { local: true },
        tools: [],
        systemPrompt: "Host",
      },
    },
    resolveSecret: async () => undefined,
  });
  t.after(() => runtime.shutdown());
  const persona = await runtime.personas.create({
    schemaVersion: 1,
    name: "Queue",
  });
  const source = join(root, "queue-personas", persona.ref.id, "skill");
  fs.mkdirSync(source);
  fs.writeFileSync(
    join(source, "SKILL.md"),
    "---\nname: skill\ndescription: Queued fixture\n---\nADMITTED-QUEUED-BODY",
  );
  const saved = await runtime.personas.save(persona.ref, persona.revision, {
    ...persona.definition,
    skills: [{ id: "skill", directory: "skill" }],
  });
  const session = await runtime.create({
    workspace: "root",
    configuration: "local",
    persona: { ...saved.ref, revision: saved.revision },
  });
  const run = runtime.start(session.id, "/skill:skill literal");
  while (!provider.requests.length)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert(
    JSON.stringify(provider.requests[0]!.context.messages).includes(
      "/skill:skill literal",
    ),
  );
  fs.writeFileSync(join(source, "SKILL.md"), "Changed original source");
  assert.equal(
    await runtime.queue(session.id, "/skill:skill queued", "follow-up"),
    "queued",
  );
  assert(
    runtime
      .snapshot(session.id)
      .queue.followUp[0]?.includes("ADMITTED-QUEUED-BODY"),
  );
  await runtime.cancel(session.id);
  assert.equal((await run.completion).outcome, "cancelled");
  await runtime.stop(session.id);
});

test("instruction byte revisions include a UTF-8 BOM even when decoded instructions are unchanged", async (t) => {
  const { store, persona, directory } = await fixture(t);
  const file = join(directory, "rules.md");
  fs.writeFileSync(file, "Identical text");
  const saved = await store.save(persona.ref, persona.revision, {
    ...persona.definition,
    instructions: [{ id: "rules", file: "rules.md" }],
  });
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("Identical text"),
    ]),
  );
  const after = resolvePersona(store, persona.ref);
  assert.equal(after.instructions[0]?.text, saved.instructions[0]?.text);
  assert.notEqual(after.revision, saved.revision);
});

test("another process's persona lock prevents mutation until that process releases it", async (t) => {
  const { store, persona, directory } = await fixture(t);
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import{mkdirSync,rmdirSync}from'node:fs';const lock=process.argv[1];mkdirSync(lock);console.log('locked');process.stdin.once('data',()=>{rmdirSync(lock);process.exit(0)});`,
      join(directory, ".persona-write.lock"),
    ],
    {
      env: {
        SystemRoot: process.env.SystemRoot,
        TEMP: tmpdir(),
        TMP: tmpdir(),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  await once(child.stdout, "data");
  const before = fs.readFileSync(join(directory, "persona.json"));
  const pending = store.save(persona.ref, persona.revision, {
    ...persona.definition,
    name: "After exclusive lock",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(fs.readFileSync(join(directory, "persona.json")), before);
  const exit = once(child, "exit");
  child.stdin.write("release");
  await exit;
  assert.equal((await pending).definition.name, "After exclusive lock");
});

test("owned instruction writes cannot enter internal locks or provisioned unreferenced skill trees", async (t) => {
  const { store, persona, directory } = await fixture(t);
  await assert.rejects(
    store.saveInstruction(
      persona.ref,
      ".persona-write.lock/rules.md",
      null,
      "No internal files",
    ),
    code("invalid-definition"),
  );
  assert(!fs.existsSync(join(directory, ".persona-write.lock")));
  const skill = join(directory, "unreferenced-skill");
  fs.mkdirSync(skill);
  fs.writeFileSync(
    join(skill, "SKILL.md"),
    "---\nname: unreferenced-skill\ndescription: Operator provisioned\n---\nBody",
  );
  await assert.rejects(
    store.saveInstruction(
      persona.ref,
      "unreferenced-skill/rules.md",
      null,
      "No skill authoring",
    ),
    code("read-only"),
  );
  assert(!fs.existsSync(join(skill, "rules.md")));
  assert(!fs.existsSync(join(directory, ".persona-write.lock")));
  assert.equal(
    (
      await store.saveInstruction(
        persona.ref,
        "own/rules.md",
        null,
        "Valid owned instruction",
      )
    ).fileRevision.length,
    64,
  );
});

test("memoized shared suffix enforces every graph path depth in both parent orders", async (t) => {
  const { store, persona } = await fixture(t);
  const chain = [persona.ref];
  for (let n = 1; n < 15; n++) {
    const next = await store.create({
      schemaVersion: 1,
      name: `Chain ${n}`,
      parents: [chain.at(-1)!],
    });
    chain.push(next.ref);
  }
  for (const length of [14, 15]) {
    const suffix = chain[length - 1]!;
    const branch = await store.create({
      schemaVersion: 1,
      name: "Branch",
      parents: [suffix],
    });
    for (const parents of [
      [suffix, branch.ref],
      [branch.ref, suffix],
    ]) {
      const draft = { ...persona.definition, parents };
      // Use a separate root, not the chain's leaf, so no accidental cycle masks the limit.
      const root = await store.create({ schemaVersion: 1, name: "Root" });
      if (length === 15)
        assert.throws(
          () => resolvePersona(store, root.ref, { ...draft, id: root.ref.id }),
          code("limit"),
        );
      else
        assert.equal(
          resolvePersona(store, root.ref, { ...draft, id: root.ref.id })
            .definitions.length,
          16,
        );
    }
  }
});

test("root skill permits repeated definition saves while all genuine support changes still conflict", async (t) => {
  const { store, persona, directory } = await fixture(t);
  fs.writeFileSync(
    join(directory, "SKILL.md"),
    "---\nname: root-skill\ndescription: Root skill fixture\n---\nBody",
  );
  fs.writeFileSync(join(directory, "arbitrary.tmp"), "Real support");
  const first = await store.save(persona.ref, persona.revision, {
    ...persona.definition,
    skills: [{ id: "root-skill", directory: "." }],
  });
  const second = await store.save(persona.ref, first.revision, {
    ...first.definition,
    description: "Second",
  });
  const third = await store.save(persona.ref, second.revision, {
    ...second.definition,
    description: "Third",
  });
  assert.notEqual(third.revision, second.revision);
  assert.notEqual(third.effectiveRevision, second.effectiveRevision); // persona.json is real skill support.
  const original = fs.fsyncSync;
  fs.fsyncSync = (fd) => {
    original(fd);
    fs.writeFileSync(
      join(directory, "arbitrary.tmp"),
      "Concurrent real support edit",
    );
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      store.save(persona.ref, third.revision, {
        ...third.definition,
        description: "Not saved",
      }),
      code("revision-conflict"),
    );
  } finally {
    fs.fsyncSync = original;
    syncBuiltinESMExports();
  }
  assert.equal(store.read(persona.ref).definition.description, "Third");
  assert.deepEqual(fs.readdirSync(directory).sort(), [
    "SKILL.md",
    "arbitrary.tmp",
    "persona.json",
  ]);
  assert.equal(
    fs.readFileSync(join(directory, "arbitrary.tmp"), "utf8"),
    "Concurrent real support edit",
  );
});

test("waiting owned-file writer rechecks current declaration and configured skill ownership inside lock", async (t) => {
  const { store, persona, directory } = await fixture(t);
  fs.mkdirSync(join(directory, "own"));
  fs.writeFileSync(join(directory, "own", "rules.md"), "Unchanged bytes");
  for (const becomesSkill of [false, true]) {
    const original = {
      ...persona.definition,
      instructions: [{ id: "rules", file: "own/rules.md" }],
    };
    fs.writeFileSync(join(directory, "persona.json"), JSON.stringify(original));
    const revision = store.instruction(persona.ref, "own/rules.md").revision;
    const next = {
      ...persona.definition,
      ...(becomesSkill ? { skills: [{ id: "own", directory: "own" }] } : {}),
    };
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import{mkdirSync,rmdirSync,writeFileSync}from'node:fs';const dir=process.argv[1];mkdirSync(dir+'/.persona-write.lock');console.log('locked');process.stdin.once('data',()=>{writeFileSync(dir+'/persona.json',process.argv[2]);rmdirSync(dir+'/.persona-write.lock');process.exit(0)});`,
        directory,
        JSON.stringify(next),
      ],
      {
        env: {
          SystemRoot: process.env.SystemRoot,
          TEMP: tmpdir(),
          TMP: tmpdir(),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    await once(child.stdout, "data");
    const pending = store.saveInstruction(
      persona.ref,
      "own/rules.md",
      revision,
      "Must not be written",
    );
    await new Promise((r) => setTimeout(r, 50));
    const exit = once(child, "exit");
    child.stdin.write("release");
    await exit;
    await assert.rejects(
      pending,
      code(becomesSkill ? "read-only" : "invalid-definition"),
    );
    assert.equal(
      fs.readFileSync(join(directory, "own", "rules.md"), "utf8"),
      "Unchanged bytes",
    );
    assert(!fs.existsSync(join(directory, ".persona-write.lock")));
  }
});

test("file-save revision evidence cannot bless a parent changed during atomic write", async (t) => {
  const { store, persona, directory } = await fixture(t);
  const parent = await store.create({
    schemaVersion: 1,
    name: "Concurrent parent",
  });
  fs.writeFileSync(join(directory, "rules.md"), "Original");
  const saved = await store.save(persona.ref, persona.revision, {
    ...persona.definition,
    parents: [parent.ref],
    instructions: [{ id: "rules", file: "rules.md" }],
  });
  const file = store.instruction(persona.ref, "rules.md");
  const original = fs.fsyncSync;
  fs.fsyncSync = (fd) => {
    original(fd);
    fs.writeFileSync(
      join(store.roots.managed!, parent.ref.path, "persona.json"),
      JSON.stringify({
        ...parent.definition,
        description: "Concurrent parent change",
      }),
    );
  };
  syncBuiltinESMExports();
  let result;
  try {
    result = await store.saveInstruction(
      persona.ref,
      "rules.md",
      file.revision,
      "Saved file",
    );
  } finally {
    fs.fsyncSync = original;
    syncBuiltinESMExports();
  }
  assert.equal(result.beforeRevision, undefined);
  assert(result.revision);
  assert.equal(store.instruction(persona.ref, "rules.md").text, "Saved file");
  await assert.rejects(
    store.save(persona.ref, saved.revision, saved.definition),
    code("revision-conflict"),
  );
});
