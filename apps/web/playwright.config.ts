import { defineConfig } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const testRoot =
  process.env.PISPARK_TEST_STATE_ROOT ??
  mkdtempSync(join(tmpdir(), "pispark-browser-state-"));
const home = join(testRoot, "home");
mkdirSync(home, { recursive: true });

const production = process.env.PISPARK_TEST_PRODUCTION === "1";
const baseURL =
  process.env.PISPARK_TEST_URL ??
  `http://127.0.0.1:${production ? 4181 : 4180}`;
const port = new URL(baseURL).port;
const apiPort = process.env.PISPARK_TEST_API_PORT ?? "4182";

export default defineConfig({
  testDir: "./tests",
  outputDir: join(testRoot, "results"),
  fullyParallel: false,
  workers: 1,
  use: {
    channel: process.env.PISPARK_BROWSER_CHANNEL || undefined,
    baseURL,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node --import tsx ../server/test/fixtures/browser-host.ts",
      env: {
        HOME: home,
        USERPROFILE: home,
        PISPARK_CONFIG: "",
        PORT: production ? port : apiPort,
        PISPARK_DEV_ORIGIN: production ? "" : baseURL,
      },
      url: production
        ? `${baseURL}/api/health`
        : `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
    },
    ...(production
      ? []
      : [
          {
            command: `npm exec vite -- --host 127.0.0.1 --port ${port} --strictPort`,
            env: { PISPARK_API_TARGET: `http://127.0.0.1:${apiPort}` },
            url: baseURL,
            reuseExistingServer: false,
          },
        ]),
  ],
});
