import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run the real compiled entry on an empty, private temporary data folder; never discover operator credentials.
const root = await mkdtemp(join(tmpdir(), "pispark-smoke-"));
const child = spawn(process.execPath, ["apps/server/dist/index.js"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, PISPARK_HOME: root, PISPARK_DEV_ORIGIN: "", HOST: "127.0.0.1", PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});
const exited = once(child, "exit");
const deadline = setTimeout(() => {
  child.kill();
}, 15000);
try {
  const base = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      reject(new Error(`Server exited (${code}): ${output}`)),
    );
    child.stdout.on("data", () => {
      const match = output.match(
        /PiSpark listening at (http:\/\/127\.0\.0\.1:\d+)/,
      );
      if (match) resolve(match[1]);
    });
  });
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "pispark" });
  assert.equal((await fetch(`${base}/api/missing`)).status, 404);
  const providers = await fetch(`${base}/api/providers`);
  assert.equal(providers.status, 200);
  const catalog = await providers.json();
  assert(catalog.providers.length > 0);
  assert.equal(catalog.defaultModel, null);
  assert(catalog.providers.every(provider => !provider.stored));
  // First start creates the data folder with a Default persona that has Pi's built-in tools.
  const personas = await (await fetch(`${base}/api/personas`)).json();
  assert.deepEqual(personas.personas.map((p) => p.id), ["default"]);
  const saved = JSON.parse(await readFile(join(root, "personas", "default", "persona.json"), "utf8"));
  assert(saved.on.includes("tool:bash"));
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const html = await page.text();
  assert.match(html, /PiSpark/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
    (match) => match[1],
  );
  assert(
    assets.some((asset) => asset.endsWith(".js")),
    "Built JavaScript must be linked",
  );
  assert(
    assets.some((asset) => asset.endsWith(".css")),
    "Built CSS must be linked",
  );
  for (const asset of [...assets, "/favicon.svg"]) {
    const response = await fetch(`${base}${asset}`);
    assert.equal(response.status, 200, asset);
    assert((await response.arrayBuffer()).byteLength > 0, asset);
  }
  console.log(
    `Production HTTP smoke passed: health, first-start Default persona, private native provider catalog, API 404, HTML, ${assets.length} built assets, favicon.`,
  );
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null) child.kill("SIGTERM");
  await exited;
  // Windows forcibly terminates a child on kill; signal handlers are checked manually on POSIX.
  await rm(root, { recursive: true, force: true });
  console.log("Smoke server stopped; temporary storage removed.");
}
