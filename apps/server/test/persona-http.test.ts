import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createAppServer } from "../src/server.js";
import { SessionRuntime } from "../src/runtime/session-runtime.js";
import { SessionHttp } from "../src/session-http.js";
import { SafeLogger } from "../src/logger.js";
import { LocalProviderControl } from "./fixtures/local-provider.js";
import type { PersonaView } from "../src/persona-protocol.js";
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pispark-persona-http-"));
  const external = join(root, "external");
  await mkdir(external);
  const logs: string[] = [],
    logger = new SafeLogger({
      sink: async (line) => {
        logs.push(line);
      },
    });
  const provider = new LocalProviderControl();
  provider.automatic = true;
  const runtime = new SessionRuntime(
    {
      storageDir: join(root, "sessions"),
      personas: {
        directory: join(root, "personas"),
        roots: { examples: external },
      },
      workspaces: { cwd: root },
      configurations: {
        local: {
          provider: provider.provider,
          modelId: "deterministic",
          credential: { local: true },
          tools: [],
          systemPrompt: "Host",
        },
      },
      resolveSecret: async () => undefined,
    },
    undefined,
    logger,
  );
  const http = new SessionHttp(
      runtime,
      { configurations: [], workspaces: [] },
      undefined,
      undefined,
      logger,
    ),
    server = createAppServer({ sessions: http, logger });
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
    await rm(root, { recursive: true, force: true });
  });
  const post = async (operation: string, value: unknown) =>
    fetch(`${base}/api/personas/${operation}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify(value),
    });
  const create = async (name: string): Promise<PersonaView> => {
    const response = await post("create", {
      definition: { schemaVersion: 1, name },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  return { root, external, runtime, http, base, logs, post, create };
}
test("persona HTTP real create/file save/compose/validate/save/read and stale conflict", async (t) => {
  const { base, post, create } = await fixture(t);
  const a = await create("Base");
  const file = await post("instruction", {
    ref: a.ref,
    path: "rules.md",
    expectedRevision: null,
    text: "PRIVATE-INSTRUCTION",
  });
  assert.equal(file.status, 200);
  const draft = {
    ...a.definition,
    instructions: [{ id: "rule", file: "rules.md" }],
  };
  assert.equal(
    (await post("validate", { ref: a.ref, definition: draft })).status,
    200,
  );
  const savedResponse = await post("save", {
    ref: a.ref,
    expectedRevision: a.revision,
    definition: draft,
  });
  const saved = await savedResponse.json();
  assert.equal(savedResponse.status, 200);
  const derived = await create("Derived");
  const composed = await post("save", {
    ref: derived.ref,
    expectedRevision: derived.revision,
    definition: {
      ...derived.definition,
      parents: [a.ref],
      instructions: [{ id: "rule", replace: true, text: "Child" }],
    },
  });
  assert.equal(composed.status, 200);
  assert.equal((await composed.json()).instructions[0].text, "Child");
  const stale = await post("save", {
    ref: a.ref,
    expectedRevision: a.revision,
    definition: draft,
  });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).requestId, /^[a-f0-9-]{36}$/);
  const list = await (await fetch(`${base}/api/personas`)).json();
  assert.equal(list.personas.length, 2);
  assert(!JSON.stringify(list).includes("PRIVATE-INSTRUCTION"));
  const read = await post("read", { ref: saved.ref });
  assert.equal((await read.json()).definition.instructions[0].file, "rules.md");
});
test("persona HTTP enforces same-origin, exact schema, reference/path/body bounds and read-only roots", async (t) => {
  const { post, create, base, external } = await fixture(t);
  const a = await create("Managed");
  const foreign = await fetch(`${base}/api/personas/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://evil.invalid",
    },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
  const cross = await fetch(`${base}/api/personas`, {
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(cross.status, 403);
  assert.equal(
    (await post("read", { ref: a.ref, extra: "SECRET" })).status,
    400,
  );
  assert.equal(
    (await post("read", { ref: { ...a.ref, path: "../private" } })).status,
    400,
  );
  assert.equal(
    (
      await post("instruction", {
        ref: a.ref,
        path: "../private.md",
        expectedRevision: null,
        text: "SECRET",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("create", {
        definition: { schemaVersion: 1, name: "X", extensions: [] },
      })
    ).status,
    400,
  );
  const oversized = await post("create", {
    definition: {
      schemaVersion: 1,
      name: "X",
      description: "x".repeat(513 * 1024),
    },
  });
  assert.equal(oversized.status, 400);
  const id = randomUUID();
  await mkdir(join(external, "base"));
  await writeFile(
    join(external, "base", "persona.json"),
    JSON.stringify({ schemaVersion: 1, id, name: "External" }),
  );
  const ref = { root: "examples", path: "base", id },
    externalView = await (await post("read", { ref })).json();
  assert.equal(externalView.writable, false);
  assert.equal(
    (
      await post("save", {
        ref,
        expectedRevision: externalView.revision,
        definition: externalView.definition,
      })
    ).status,
    403,
  );
});
test("persona HTTP safe correlated diagnostics and shutdown refuse new writes", async (t) => {
  const { post, create, logs, runtime } = await fixture(t);
  const a = await create("Safe");
  const result = await post("validate", {
    ref: a.ref,
    definition: {
      ...a.definition,
      instructions: [{ id: "rule", file: "PRIVATE-RESOURCE.md" }],
    },
  });
  assert.equal(result.status, 422);
  const failure = await result.json();
  assert.equal(failure.error, "missing-resource");
  assert(!JSON.stringify(failure).includes("PRIVATE-RESOURCE"));
  assert(logs.some((line) => JSON.parse(line).requestId === failure.requestId));
  assert(!logs.join("").includes("PRIVATE-RESOURCE"));
  await runtime.personas.shutdown();
  assert.equal(
    (
      await post("create", {
        definition: { schemaVersion: 1, name: "Stopped" },
      })
    ).status,
    503,
  );
});

test("persona HTTP distinguishes missing identities, resource conflicts and schema limits", async (t) => {
  const { post, create } = await fixture(t);
  const a = await create("A"),
    b = await create("B"),
    child = await create("Join");
  for (const saved of [a, b]) {
    assert.equal(
      (
        await post("save", {
          ref: saved.ref,
          expectedRevision: saved.revision,
          definition: {
            ...saved.definition,
            instructions: [{ id: "tone", text: saved.definition.name }],
          },
        })
      ).status,
      200,
    );
  }
  const conflict = await post("validate", {
    ref: child.ref,
    definition: { ...child.definition, parents: [a.ref, b.ref] },
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).diagnostics[0].resourceId, "tone");
  const id = randomUUID();
  assert.equal(
    (await post("read", { ref: { root: "managed", path: id, id } })).status,
    404,
  );
  assert.equal(
    (
      await post("validate", {
        ref: child.ref,
        definition: {
          ...child.definition,
          instructions: Array.from({ length: 33 }, (_, i) => ({
            id: `entry-${i}`,
            text: "x",
          })),
        },
      })
    ).status,
    400,
  );
});
