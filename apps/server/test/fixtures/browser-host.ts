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
const root = await mkdtemp(join(tmpdir(), "pispark-browser-"));
await mkdir(join(root, "workspace"));
await writeFile(
    join(root, "workspace", "sample.txt"),
    "native browser tool result",
);
const provider = new LocalProviderControl();
const configuration = {
    storageDir: join(root, "state"),
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
                fileURLToPath(
                    new URL("./controlled-extension.mjs", import.meta.url),
                ),
            ],
        },
    },
    resolveSecret: async () => undefined,
};
const settingsFixture = await localProviderSettings(join(root, "providers"));
Object.assign(configuration.configurations, { "Catalog resources": { credential: { stored: true }, systemPrompt: "Test-only catalog configuration", tools: [] } });
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
    for (const request of [...provider.requests, ...settingsFixture.control.requests])
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
    await rm(root, { recursive: true, force: true });
}
process.on("SIGTERM", () => {
    void shutdown();
});
process.on("SIGINT", () => {
    void shutdown();
});
