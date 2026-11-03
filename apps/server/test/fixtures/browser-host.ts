/** Test-only executable. Never imported by production source or enabled by a production flag. */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionRuntime } from "../../src/runtime/session-runtime.js";
import { SessionHttp } from "../../src/session-http.js";
import { createAppServer } from "../../src/server.js";
import { catalog } from "../../src/host-configuration.js";
import { LocalProviderControl } from "./local-provider.js";
import { localProviderSettings } from "./provider-settings.js";
import { ProviderHttp } from "../../src/provider-http.js";
// Optional test-harness-owned persistent state; never a production configuration switch.
const persistentRoot = process.argv[2];
const root =
  persistentRoot ?? (await mkdtemp(join(tmpdir(), "pispark-browser-")));
await mkdir(root, { recursive: true });
const examples = join(root, "examples");
await mkdir(join(examples, "review", "skills", "review", "references"), {
  recursive: true,
});
await writeFile(
  join(examples, "review", "persona.json"),
  JSON.stringify({
    schemaVersion: 1,
    id: "10000000-0000-4000-8000-000000000001",
    name: "Test review library",
    skills: [{ id: "review", directory: "skills/review" }],
  }),
);
await writeFile(
  join(examples, "review", "skills", "review", "SKILL.md"),
  "---\nname: review\ndescription: Read the deterministic test checklist\n---\nRead references/check.md before reviewing.",
);
await writeFile(
  join(examples, "review", "skills", "review", "references", "check.md"),
  "NATIVE-COPIED-SUPPORT",
);
for (const [path, content] of Object.entries({
  "malformed-one": "{broken-one",
  "malformed-two": "{broken-two",
  unsupported: JSON.stringify({
    schemaVersion: 2,
    id: "10000000-0000-4000-8000-000000000002",
    name: "Future document",
  }),
  missing: JSON.stringify({
    schemaVersion: 1,
    id: "10000000-0000-4000-8000-000000000003",
    name: "Missing instruction fixture",
    instructions: [{ id: "missing", file: "absent.md" }],
  }),
  "cycle-a": JSON.stringify({
    schemaVersion: 1,
    id: "10000000-0000-4000-8000-000000000004",
    name: "Cycle fixture",
    parents: [
      {
        root: "examples",
        path: "cycle-b",
        id: "10000000-0000-4000-8000-000000000005",
      },
    ],
  }),
  "cycle-b": JSON.stringify({
    schemaVersion: 1,
    id: "10000000-0000-4000-8000-000000000005",
    name: "Cycle peer",
    parents: [
      {
        root: "examples",
        path: "cycle-a",
        id: "10000000-0000-4000-8000-000000000004",
      },
    ],
  }),
})) {
  await mkdir(join(examples, path), { recursive: true });
  await writeFile(join(examples, path, "persona.json"), content);
}
await mkdir(join(root, "workspace"), { recursive: true });
await writeFile(
  join(root, "workspace", "sample.txt"),
  "native browser tool result",
);
const provider = new LocalProviderControl();
const configuration = {
  storageDir: join(root, "state"),
  personas: { directory: join(root, "personas"), roots: { examples } },
  workspaces: {
    workspace: join(root, "workspace"),
    notes: join(root, "workspace"),
  },
  configurations: {
    "Test-only deterministic": {
      modelId: "deterministic",
      provider: provider.provider,
      credential: { local: true as const },
      systemPrompt: "Local test only. No network provider.",
      tools: ["read"],
      extensions: [
        fileURLToPath(new URL("./controlled-extension.mjs", import.meta.url)),
      ],
    },
  },
  resolveSecret: async () => undefined,
};
const settingsFixture = await localProviderSettings(join(root, "providers"));
Object.assign(configuration.configurations, {
  "Catalog resources": {
    credential: { stored: true },
    systemPrompt: "Test-only catalog configuration",
    tools: [],
  },
});
const runtime = new SessionRuntime(configuration, settingsFixture.settings);
const sessions = new SessionHttp(
  runtime,
  catalog(configuration),
  process.env.PISPARK_DEV_ORIGIN,
  new ProviderHttp(settingsFixture.settings),
);
const server = createAppServer({
  sessions,
  webRoot: fileURLToPath(new URL("../../../web/dist/", import.meta.url)),
});
const seen = new WeakSet<object>();
const interval = setInterval(() => {
  for (const request of [
    ...provider.requests,
    ...settingsFixture.control.requests,
  ])
    if (!seen.has(request)) {
      seen.add(request);
      const last = request.context.messages.findLast(
        (message) => message.role === "user",
      );
      if (!JSON.stringify(last).includes("hold"))
        setTimeout(request.release, 800);
    }
}, 20);
server.listen(Number(process.env.PORT ?? 4182), "127.0.0.1");
async function shutdown() {
  clearInterval(interval);
  await sessions.shutdown();
  server.closeAllConnections();
  server.close();
  if (!persistentRoot) await rm(root, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});

// IPC is available only to the process that launched this test executable.
process.on("message", (message) => {
  if (message === "shutdown") void shutdown();
});
