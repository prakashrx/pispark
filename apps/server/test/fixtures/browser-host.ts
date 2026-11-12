/** Test-only executable for Playwright. Never imported by production source or enabled by a production flag. */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionRuntime } from "../../src/core/runtime/session-runtime.js";
import { SessionHttp } from "../../src/http/session-http.js";
import { createAppServer } from "../../src/http/server.js";
import { localProviderSettings } from "./provider-settings.js";
import { ProviderHttp } from "../../src/http/provider-http.js";
import { WORKSPACE_POINTS } from "../../src/http/workspace-points.js";
import { addControlledExtension, addFrontendExtension, addViewExtension, writePersona } from "./home.js";

// Optional harness-owned persistent state; never a production configuration switch.
const persistentRoot = process.argv[2];
const root =
  persistentRoot ?? (await mkdtemp(join(tmpdir(), "pispark-browser-")));
const home = join(root, "home");
await mkdir(home, { recursive: true });
const workspace = join(root, "workspace");
await mkdir(workspace, { recursive: true });
await writeFile(join(workspace, "sample.txt"), "native browser tool result");
// Ask starts chats in the host's home folder. The harness points HOME at a temporary folder;
// only then is the sample file placed there too.
const testHome = homedir();
if (testHome.startsWith(tmpdir()) && existsSync(testHome))
  await writeFile(join(testHome, "sample.txt"), "native browser tool result");
// First start of this data folder: a Default with read and the controlled extension,
// and a Review persona with a skill and a command.
if (!existsSync(join(home, "personas", "default", "persona.json"))) {
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
  // An extension that places Svelte components at the session's points through Pi's bus.
  await writePersona(home, "views", { name: "Extension views", description: "Components placed by an extension" });
  await addViewExtension(home, "views");
  // An extension whose one component is its own frontend for the chat.
  await writePersona(home, "frontend", { name: "Custom frontend", description: "A chat frontend supplied by an extension" });
  await addFrontendExtension(home, "frontend");
  // An app persona: opened from the sidebar, its sessions show the Log view first.
  await writePersona(home, "log-app", { name: "Log app", description: "An app that opens on its Log view", home: "log" });
  await addFrontendExtension(home, "log-app");
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
const runtime = new SessionRuntime({ home, points: WORKSPACE_POINTS }, settingsFixture.settings);
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
