import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAppServer } from "./server.js";

const host = process.env.HOST ?? "127.0.0.1";
const portInput = process.env.PORT ?? "3000";
if (!/^\d+$/.test(portInput) || Number(portInput) > 65535) {
  console.error("PORT must be an integer between 0 and 65535.");
  process.exit(1);
}
const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const server = createAppServer({ webRoot });
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
