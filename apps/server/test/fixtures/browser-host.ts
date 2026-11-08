/** Test-only executable for Playwright. Never imported by production source or enabled by a production flag. */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionRuntime } from "../../src/runtime/session-runtime.js";
import { SessionHttp } from "../../src/session-http.js";
import { createAppServer } from "../../src/server.js";
import { localProviderSettings } from "./provider-settings.js";
import { ProviderHttp } from "../../src/provider-http.js";
import { addControlledExtension, writePersona } from "./home.js";

// Optional harness-owned persistent state; never a production configuration switch.
const persistentRoot = process.argv[2];
const root =
  persistentRoot ?? (await mkdtemp(join(tmpdir(), "pispark-browser-")));
const home = join(root, "home");
await mkdir(home, { recursive: true });
const workspace = join(root, "workspace");
await mkdir(workspace, { recursive: true });
await writeFile(join(workspace, "sample.txt"), "native browser tool result");
// First run only: a Default with read and the controlled extension, and a Review persona with a skill.
if (!persistentRoot) {
  await writePersona(
    home,
    "default",
    { name: "Default", description: "The base of every persona.", on: ["tool:read"] },
    { "instructions/local.md": "Local test only. No network provider." },
  );
  await addControlledExtension(home, "default");
  await writePersona(
    home,
    "review",
    { name: "Review", description: "Careful code review" },
    {
      "skills/review/SKILL.md":
        "---\nname: review\ndescription: Read the deterministic test checklist\n---\nRead references/check.md before reviewing.",
      "skills/review/references/check.md": "NATIVE-SUPPORT",
      "prompts/checklist.md": "---\ndescription: Run the checklist\n---\nRun the checklist on $1",
    },
  );
}
const settingsFixture = await localProviderSettings(join(home, "providers"));
// The local auth provider is signed in and the default, so chats can start without setup.
await writeFile(
  settingsFixture.authPath,
  JSON.stringify({ "pispark-local-test": { type: "api_key", key: "test-key" } }),
);
await settingsFixture.runtime.refresh({ allowNetwork: false });
await settingsFixture.settings.setDefault({
  provider: "pispark-local-test",
  id: "deterministic",
});
const runtime = new SessionRuntime({ home }, settingsFixture.settings);
const sessions = new SessionHttp(
  runtime,
  process.env.PISPARK_DEV_ORIGIN,
  new ProviderHttp(settingsFixture.settings),
);
const server = createAppServer({
  sessions,
  webRoot: fileURLToPath(new URL("../../../web/dist/", import.meta.url)),
});
const seen = new WeakSet<object>();
const interval = setInterval(() => {
  for (const request of settingsFixture.control.requests)
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
console.log(`PISPARK_TEST_WORKSPACE=${workspace}`);
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
