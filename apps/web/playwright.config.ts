import { defineConfig } from "@playwright/test";

const production = process.env.PISPARK_TEST_PRODUCTION === "1";
const baseURL =
  process.env.PISPARK_TEST_URL ??
  `http://127.0.0.1:${production ? 4181 : 4180}`;
const port = new URL(baseURL).port;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  use: {
    channel: process.env.PISPARK_BROWSER_CHANNEL || undefined,
    baseURL,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: production
      ? "node ../server/dist/index.js"
      : `npm exec vite -- --host 127.0.0.1 --port ${port} --strictPort`,
    env: { HOST: "127.0.0.1", PORT: port },
    url: baseURL,
    reuseExistingServer: !production && !process.env.CI,
  },
});
