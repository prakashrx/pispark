import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAppServer } from "./server.js";
import { hostConfiguration, catalog } from "./host-configuration.js";
import { SessionRuntime } from "./runtime/session-runtime.js";
import { SessionHttp } from "./session-http.js";
import { ProviderSettings } from "./runtime/provider-settings.js";
import { ProviderHttp } from "./provider-http.js";

const host = process.env.HOST ?? "127.0.0.1";
if (!["127.0.0.1", "::1"].includes(host))
  throw new Error(
    "HOST must be literal loopback; remote unauthenticated hosting is not supported.",
  );
const portInput = process.env.PORT ?? "3000";
if (!/^\d+$/.test(portInput) || Number(portInput) > 65535) {
  console.error("PORT must be an integer between 0 and 65535.");
  process.exit(1);
}
const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const configuration = await hostConfiguration();
const developmentOrigin =
  process.env.PISPARK_DEV_ORIGIN ??
  (process.argv.includes("--dev") ? "http://127.0.0.1:5173" : undefined);
if (
  developmentOrigin &&
  !/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(developmentOrigin)
)
  throw new Error(
    "PISPARK_DEV_ORIGIN must be an explicit loopback HTTP origin.",
  );
const providers = await ProviderSettings.create(configuration);
const sessions = new SessionHttp(
  new SessionRuntime(configuration, providers),
  catalog(configuration),
  developmentOrigin,
  new ProviderHttp(providers),
);
const server = createAppServer({ webRoot, sessions });
server.maxConnections = 64;
server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.on("error", (error) => {
  console.error(
    `PiSpark could not listen on ${host}:${portInput}: ${error.message}`,
  );
  process.exitCode = 1;
});
server.listen(Number(portInput), host, () => {
  const address = server.address();
  const port =
    address && typeof address !== "string" ? address.port : portInput;
  console.log(`PiSpark listening at http://${host}:${port}`);
  if (!existsSync(new URL("../../web/dist/index.html", import.meta.url))) {
    console.log(
      "Frontend not built. Use the Vite dev URL, or run npm run build from the repository root.",
    );
  }
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`PiSpark stopping (${signal}).`);
  void sessions.shutdown().catch(() => {
    console.error(
      "Session shutdown failed; ownership is retained until cleanup finishes.",
    );
    process.exitCode = 1;
  });
  const timeout = setTimeout(() => server.closeAllConnections(), 5000);
  timeout.unref();
  server.close((error) => {
    clearTimeout(timeout);
    if (error) {
      console.error("Shutdown failed:", error.message);
      process.exitCode = 1;
    }
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
