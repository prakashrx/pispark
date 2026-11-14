import { existsSync } from "node:fs";
import { SafeLogger } from "./core/logger.js";
import { fileURLToPath } from "node:url";
import { createAppServer } from "./http/server.js";
import { hostConfiguration } from "./http/host-configuration.js";
import { lockHome, prepareHome } from "./core/home.js";
import { SessionRuntime } from "./core/runtime/session-runtime.js";
import { SessionHttp } from "./http/session-http.js";
import { ProviderSettings } from "./core/runtime/provider-settings.js";
import { ProviderHttp } from "./http/provider-http.js";
import { HostHttp } from "./http/host-http.js";
import { HostLink } from "./core/host-link.js";

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
const configuration = hostConfiguration();
// First start creates the folders (and the Default persona, via the runtime).
const paths = prepareHome(configuration.home);
const releaseHome = lockHome(paths);
process.on("exit", releaseHome);
const logger = new SafeLogger({ directory: paths.logs });
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
const runtime = new SessionRuntime(configuration, providers, logger);
// The launcher (when it started this server) asks for a graceful shutdown over its channel.
const link = new HostLink(() => runtime.runningWork(), () => shutdown());
const sessions = new SessionHttp(
  runtime,
  developmentOrigin,
  new ProviderHttp(providers),
  logger,
  new HostHttp(link, paths.root, () => runtime.runningWork()),
);
const server = createAppServer({ webRoot, sessions, logger });
server.maxConnections = 64;
server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.on("error", () => {
  logger.event(
    "http.failure",
    { outcome: "failed", code: "configuration" },
    "error",
  );
  process.exitCode = 1;
});
server.listen(Number(portInput), host, () => {
  const address = server.address();
  const port =
    address && typeof address !== "string" ? address.port : portInput;
  console.log(`PiSpark listening at http://${host}:${port}`);
  console.log(`Data folder: ${paths.root}`);
  logger.event("host.start", { outcome: "completed" });
  if (!existsSync(new URL("../../web/dist/index.html", import.meta.url))) {
    console.log(
      "Frontend not built. Use the Vite dev URL, or run npm run build from the repository root.",
    );
  }
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.event("host.stop", { outcome: "completed" });
  void sessions
    .shutdown()
    .catch(() => {
      logger.event(
        "session.failure",
        { outcome: "failed", code: "shutdown" },
        "error",
      );
      process.exitCode = 1;
    })
    .finally(() => {
      logger.close();
      link.close();
    });
  const timeout = setTimeout(() => server.closeAllConnections(), 5000);
  timeout.unref();
  server.close((error) => {
    clearTimeout(timeout);
    if (error) {
      logger.event(
        "http.failure",
        { outcome: "failed", code: "shutdown" },
        "error",
      );
      process.exitCode = 1;
    }
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
