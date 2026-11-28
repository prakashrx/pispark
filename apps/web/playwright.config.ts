import { defineConfig } from "@playwright/test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const testRoot = process.env.PISPARK_TEST_STATE_ROOT ?? mkdtempSync(join(tmpdir(), "pispark-browser-state-"));
const home = join(testRoot, "home");
mkdirSync(home, { recursive: true });

const production = process.env.PISPARK_TEST_PRODUCTION === "1";
const baseURL = process.env.PISPARK_TEST_URL ?? `http://127.0.0.1:${production ? 4181 : 4180}`;
const port = new URL(baseURL).port;
const apiPort = process.env.PISPARK_TEST_API_PORT ?? "4182";
// GitHub sets CI. Its Windows machines are several times slower than a desk machine (cold disks,
// virus scanning, slow process starts), so every wait gets more room there. No retries: a retry would
// hide a real race, and a longer wait still fails on a real hang.
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  // CI collects results from a known folder; the test data stays in its own temporary folder.
  outputDir: process.env.PISPARK_TEST_RESULTS ?? join(testRoot, "results"),
  fullyParallel: false,
  workers: 1,
  timeout: ci ? 90_000 : 30_000,
  expect: { timeout: ci ? 15_000 : 5_000 },
  retries: 0,
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
        PORT: production ? port : apiPort,
        PISPARK_DEV_ORIGIN: production ? "" : baseURL,
      },
      url: production ? `${baseURL}/api/health` : `http://127.0.0.1:${apiPort}/api/health`,
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
