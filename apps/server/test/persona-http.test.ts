import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import { join } from "node:path";
import { createAppServer } from "../src/http/server.js";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { SessionHttp } from "../src/http/session-http.js";
import { SafeLogger } from "../src/core/logger.js";
import type { PersonaSummary, PersonaView } from "../src/contract/persona-protocol.js";
import { testHome } from "./fixtures/home.js";

async function fixture(t: TestContext) {
  const h = await testHome("pispark-persona-http-");
  const logs: string[] = [];
  const logger = new SafeLogger({
    sink: async (line) => {
      logs.push(line);
    },
  });
  h.provider.automatic = true;
  const runtime = new SessionRuntime(h.configuration, undefined, logger);
  const http = new SessionHttp(runtime, undefined, undefined, logger);
  const server = createAppServer({ sessions: http, logger });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await http.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await logger.close();
    await h.remove();
  });
  const post = (operation: string, value: unknown, origin = base) =>
    fetch(`${base}/api/personas/${operation}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(value),
    });
  const ok = async <T>(operation: string, value: unknown): Promise<T> => {
    const response = await post(operation, value);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<T>;
  };
  const list = async () =>
    ((await (await fetch(`${base}/api/personas`)).json()) as {
      personas: PersonaSummary[];
    }).personas;
  return { ...h, runtime, base, logs, post, ok, list };
}

test("persona HTTP: list Default, create, view the resolved layers, revision-checked save", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    (await f.list()).map((p) => [p.id, p.builtIn]),
    [["default", true]],
  );
  const { id } = await f.ok<{ id: string }>("create", {
    name: "Dev helper",
    description: "Coding",
  });
  assert.equal(id, "dev-helper");
  const view = await f.ok<PersonaView>("read", { target: { persona: id } });
  assert.deepEqual(view.layers.map((l) => l.id), ["default", "dev-helper"]);
  assert.ok(view.tools.find((tool) => tool.name === "bash")!.on);
  const saved = await f.ok<{ revision: string }>("save", {
    target: { persona: id },
    expectedRevision: view.revision,
    definition: { ...view.definition, off: ["tool:bash"] },
  });
  const stale = await f.post("save", {
    target: { persona: id },
    expectedRevision: view.revision,
    definition: view.definition,
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, "revision-conflict");
  const after = await f.ok<PersonaView>("read", { target: { persona: id } });
  assert.equal(after.revision, saved.revision);
  assert.equal(after.tools.find((tool) => tool.name === "bash")!.on, false);
  const cycle = await f.post("save", {
    target: { persona: "default" },
    expectedRevision: (await f.ok<PersonaView>("read", { target: { persona: "default" } })).revision,
    definition: { name: "Default", base: ["dev-helper"] },
  });
  assert.equal(cycle.status, 400);
});

test("persona HTTP: item files, chat layers and delete rules", async (t) => {
  const f = await fixture(t);
  await f.ok("create", { name: "Dev" });
  const target = { persona: "dev" };
  const file = await f.ok<{ revision: string }>("file/write", {
    target,
    path: "skills/review/SKILL.md",
    expectedRevision: null,
    text: "---\nname: review\ndescription: Review code\n---\nSteps",
  });
  const view = await f.ok<PersonaView>("read", { target });
  const skill = view.items.find((item) => item.name === "review")!;
  assert.equal(skill.description, "Review code");
  assert.equal(skill.path, "skills/review/SKILL.md");
  assert.equal(
    (await f.ok<{ text: string }>("file/read", { target, path: skill.path })).text.includes("Steps"),
    true,
  );
  // A chat layer is created by its first edit and stacks on the chat's persona.
  const chat = await f.runtime.create({ folder: await f.folder("work"), persona: "dev" });
  const layer = { chat: chat.id };
  const before = await f.ok<PersonaView>("read", { target: layer });
  assert.equal(before.revision, "");
  assert.deepEqual(before.definition, { base: ["dev"] });
  await f.ok("save", {
    target: layer,
    expectedRevision: "",
    definition: { base: ["dev"], off: ["skill:review"] },
  });
  const layered = await f.ok<PersonaView>("read", { target: layer });
  assert.deepEqual(layered.layers.map((l) => l.id), ["default", "dev", "chat"]);
  assert.equal(layered.items.find((i) => i.name === "review")!.on, false);
  assert.equal(f.runtime.list()[0]!.persona.layered, true);
  await f.ok("file/delete", { target, path: skill.path, expectedRevision: file.revision });
  assert.equal((await f.ok<PersonaView>("read", { target })).items.length, 0);
  const builtIn = await f.post("delete", { id: "default" });
  assert.equal((await builtIn.json()).error, "built-in");
  await f.ok("delete", { id: "dev" });
  assert.deepEqual((await f.list()).map((p) => p.id), ["default"]);
});

test("persona HTTP: strict inputs, same-origin guard and content-free failure logs", async (t) => {
  const f = await fixture(t);
  for (const [operation, value] of [
    ["read", { target: { persona: "../x" } }],
    ["read", { target: { persona: "a", chat: "b" } }],
    ["read", { target: { persona: "default" }, extra: true }],
    ["create", { name: "X", tools: ["bash"] }],
    ["save", { target: { persona: "default" }, expectedRevision: "nope", definition: {} }],
    ["file/read", { target: { persona: "default" }, path: "../../etc/passwd" }],
    ["file/write", { target: { persona: "default" }, path: "persona.json", expectedRevision: null, text: "{}" }],
  ] as const) {
    const response = await f.post(operation, value);
    assert.equal(response.status, 400, `${operation} ${JSON.stringify(value)}`);
  }
  assert.equal((await f.post("unknown", {})).status, 404);
  assert.equal((await f.post("read", { target: { persona: "missing" } })).status, 404);
  assert.equal(
    (await f.post("create", { name: "Evil" }, "http://evil.invalid")).status,
    403,
  );
  await f.post("create", { name: "PRIVATE-NAME", base: ["missing"] });
  assert.doesNotMatch(f.logs.join(""), /PRIVATE-NAME/);
  assert.match(f.logs.join(""), /missing-parent/);
});

test("persona HTTP: a working folder is refused when it is not there, then listed and shown in the view", async (t) => {
  const f = await fixture(t);
  const folder = await f.folder("project");
  const { id } = await f.ok<{ id: string }>("create", { name: "Project" });
  const view = await f.ok<PersonaView>("read", { target: { persona: id } });
  const missing = await f.post("save", {
    target: { persona: id },
    expectedRevision: view.revision,
    definition: { ...view.definition, folder: join(folder, "missing") },
  });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "folder");
  await f.ok("save", { target: { persona: id }, expectedRevision: view.revision, definition: { ...view.definition, folder } });
  assert.equal((await f.ok<PersonaView>("read", { target: { persona: id } })).folder, folder);
  assert.equal((await f.list()).find((persona) => persona.id === id)!.folder, folder);
  // A home view is saved and listed the same way.
  const current = await f.ok<PersonaView>("read", { target: { persona: id } });
  await f.ok("save", { target: { persona: id }, expectedRevision: current.revision, definition: { ...current.definition, home: "desk" } });
  assert.equal((await f.ok<PersonaView>("read", { target: { persona: id } })).home, "desk");
  assert.equal((await f.list()).find((persona) => persona.id === id)!.home, "desk");
});
