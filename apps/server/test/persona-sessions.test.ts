import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  SessionRuntime,
  type RuntimeConfiguration,
  RuntimeError,
} from "../src/runtime/session-runtime.js";
import { LocalProviderControl } from "./fixtures/local-provider.js";

test("native persona admission: ordered instructions, actual progressive support-file reads, source-independent recovery and copy integrity", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-persona-session-"));
  const cwd = join(root, "cwd");
  await mkdir(cwd);
  const hostInstruction = join(root, "host.md");
  await writeFile(hostInstruction, "HOST-CONTEXT");
  const control = new LocalProviderControl();
  control.automatic = true;
  const configuration: RuntimeConfiguration = {
    storageDir: join(root, "sessions"),
    workspaces: { work: cwd },
    configurations: {
      reader: {
        credential: { local: true },
        provider: control.provider,
        modelId: "deterministic",
        tools: ["read"],
        systemPrompt: "HOST-PREAMBLE",
        instructions: [hostInstruction],
      },
      quiet: {
        credential: { local: true },
        provider: control.provider,
        modelId: "deterministic",
        tools: [],
        systemPrompt: "QUIET",
      },
    },
    resolveSecret: async () => undefined,
  };
  const runtime = new SessionRuntime(configuration);
  let recovered: SessionRuntime | undefined;
  t.after(async () => {
    await runtime.shutdown();
    await recovered?.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  const persona = await runtime.personas.create({
    schemaVersion: 1,
    name: "Writer",
    instructions: [
      { id: "first", text: "FIRST-PERSONA" },
      { id: "second", text: "SECOND-PERSONA" },
    ],
  });
  const source = join(root, "personas", persona.ref.id, "review");
  await mkdir(join(source, "references"), { recursive: true });
  await writeFile(
    join(source, "SKILL.md"),
    "---\nname: review\ndescription: Review using the checklist\n---\nRead references/check.md before reviewing.",
  );
  await writeFile(join(source, "references", "check.md"), "ADMITTED-SUPPORT");
  await writeFile(join(source, ".hidden"), "HIDDEN-SUPPORT");
  const saved = await runtime.personas.save(persona.ref, persona.revision, {
    ...persona.definition,
    skills: [{ id: "review", directory: "review" }],
  });
  const selection = { ...saved.ref, revision: saved.revision };
  const [reader, quiet] = await Promise.all([
    runtime.create({
      workspace: "work",
      configuration: "reader",
      persona: selection,
    }),
    runtime.create({
      workspace: "work",
      configuration: "quiet",
      persona: selection,
    }),
  ]);
  assert.equal(reader.persona?.name, "Writer");
  await runtime.start(reader.id, "inspect").completion;
  await runtime.start(quiet.id, "/skill:review literal").completion;
  const prompt = JSON.stringify(
    control.requests[0]!.context.messages.filter((m) => m.role === "system"),
  );
  assert(prompt.indexOf("HOST-PREAMBLE") < prompt.indexOf("FIRST-PERSONA"));
  assert(prompt.indexOf("FIRST-PERSONA") < prompt.indexOf("SECOND-PERSONA"));
  assert(prompt.indexOf("SECOND-PERSONA") < prompt.indexOf("HOST-CONTEXT"));
  assert(!prompt.includes("ADMITTED-SUPPORT"));
  assert(
    !JSON.stringify(
      control.requests[1]!.context.messages.filter((m) => m.role === "system"),
    ).includes("<skill>"),
  );
  assert(
    JSON.stringify(control.requests[1]!.context.messages).includes(
      "/skill:review literal",
    ),
  );
  const copied = join(
    root,
    "sessions",
    reader.id,
    "persona",
    "skills",
    "persona-review",
    "review",
  );
  assert(prompt.includes(JSON.stringify(copied).slice(1, -1)));
  assert.equal(
    await readFile(join(copied, ".hidden"), "utf8"),
    "HIDDEN-SUPPORT",
  );
  assert.equal(
    (
      await runtime.start(reader.id, `read:${join(copied, "SKILL.md")}`)
        .completion
    ).outcome,
    "completed",
  );
  assert(
    JSON.stringify(runtime.snapshot(reader.id).context).includes(
      "references/check.md",
    ),
  );
  await writeFile(join(source, "references", "check.md"), "SOURCE-EDIT");
  await runtime.start(
    reader.id,
    `read:${join(copied, "references", "check.md")}`,
  ).completion;
  assert(
    JSON.stringify(runtime.snapshot(reader.id).context).includes(
      "ADMITTED-SUPPORT",
    ),
  );
  assert(
    !JSON.stringify(runtime.snapshot(reader.id).context).includes(
      "SOURCE-EDIT",
    ),
  );
  await runtime.stop(reader.id);
  await runtime.stop(quiet.id);
  await rm(join(root, "personas", persona.ref.id), { recursive: true });
  await rm(hostInstruction);
  recovered = new SessionRuntime(configuration);
  await recovered.open(reader.id);
  assert.equal(
    (await recovered.start(reader.id, "still captured").completion).outcome,
    "completed",
  );
  await writeFile(join(copied, "references", "check.md"), "TAMPERED");
  assert.throws(
    () => recovered!.start(reader.id, "must fail"),
    (e: unknown) =>
      e instanceof RuntimeError && e.code === "resource-integrity",
  );
  await recovered.stop(reader.id);
  await assert.rejects(
    recovered.open(reader.id),
    (e: unknown) =>
      e instanceof RuntimeError && e.code === "resource-integrity",
  );
});

test("native admission pins revision and policy while legacy requests remain independent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-persona-policy-"));
  const provider = new LocalProviderControl();
  provider.automatic = true;
  const configuration: RuntimeConfiguration = {
    storageDir: join(root, "sessions"),
    workspaces: { cwd: root },
    configurations: {
      policy: {
        provider: provider.provider,
        modelId: "deterministic",
        credential: { local: true },
        systemPrompt: "BASE",
        tools: [],
      },
    },
    resolveSecret: async () => undefined,
  };
  const runtime = new SessionRuntime(configuration);
  t.after(async () => {
    await runtime.shutdown();
    await rm(root, { recursive: true, force: true });
  });
  const a = await runtime.personas.create({
    schemaVersion: 1,
    name: "A",
    instructions: [{ id: "a", text: "INDEPENDENT-A" }],
  });
  const b = await runtime.personas.create({
    schemaVersion: 1,
    name: "B",
    instructions: [{ id: "b", text: "INDEPENDENT-B" }],
  });
  const [one, two, legacy] = await Promise.all(
    [a, b, undefined].map((p) =>
      runtime.create({
        workspace: "cwd",
        configuration: "policy",
        ...(p ? { persona: { ...p.ref, revision: p.revision } } : {}),
      }),
    ),
  );
  await Promise.all(
    [one!, two!, legacy!].map((s) => runtime.start(s.id, "inspect").completion),
  );
  assert(
    provider.requests.some(
      (r) =>
        JSON.stringify(r.context).includes("INDEPENDENT-A") &&
        !JSON.stringify(r.context).includes("INDEPENDENT-B"),
    ),
  );
  assert(
    provider.requests.some(
      (r) =>
        JSON.stringify(r.context).includes("INDEPENDENT-B") &&
        !JSON.stringify(r.context).includes("INDEPENDENT-A"),
    ),
  );
  const updated = await runtime.personas.save(a.ref, a.revision, {
    ...a.definition,
    instructions: [{ id: "a", text: "NEW" }],
  });
  await assert.rejects(
    runtime.create({
      workspace: "cwd",
      configuration: "policy",
      persona: { ...a.ref, revision: a.revision },
    }),
    (e: unknown) => e instanceof RuntimeError && e.code === "revision-conflict",
  );
  await runtime.start(one!.id, "after saved edits").completion;
  assert(
    JSON.stringify(provider.requests.at(-1)!.context).includes("INDEPENDENT-A"),
  );
  assert(!JSON.stringify(provider.requests.at(-1)!.context).includes("NEW"));
  await runtime.stop(one!.id);
  configuration.configurations.policy!.tools.push("read");
  await assert.rejects(
    runtime.open(one!.id),
    (e: unknown) =>
      e instanceof RuntimeError && e.code === "configuration-changed",
  );
  assert.notEqual(updated.revision, a.revision);
});
