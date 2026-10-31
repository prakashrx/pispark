import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createAppServer } from "../src/server.js";

async function listen(t: TestContext, server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

// The HTTP client's path option preserves malicious paths that fetch would normalize.
function rawGet(base: string, path: string) {
  return new Promise<{ status: number | undefined; body: string }>(
    (resolve, reject) => {
      const req = request(base, { path }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode, body }),
        );
        response.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    },
  );
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "pispark-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const webRoot = join(directory, "web");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await writeFile(
    join(webRoot, "index.html"),
    "<!doctype html><title>PiSpark</title>",
  );
  await writeFile(join(webRoot, "assets", "app.js"), 'console.log("starter");');
  await writeFile(join(directory, "private.js"), "PRIVATE");
  return { directory, webRoot };
}

test("GET /api/health returns real service health", async (t) => {
  const base = await listen(t, createAppServer());
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), { status: "ok", service: "pispark" });
  const post = await fetch(`${base}/api/health`, { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
});

test("unknown API and frontend paths return 404, never the app entry", async (t) => {
  const { webRoot } = await fixture(t);
  const base = await listen(t, createAppServer({ webRoot }));
  for (const path of [
    "/api",
    "/api/missing",
    "/missing",
    "/assets/missing.js",
    "/index.html",
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/json/,
    );
  }
});

test("serves built HTML and assets with types, HEAD, and method boundaries", async (t) => {
  const { webRoot } = await fixture(t);
  const base = await listen(t, createAppServer({ webRoot }));
  const html = await fetch(base);
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await html.text(), /PiSpark/);
  const asset = await fetch(`${base}/assets/app.js?v=1`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type") ?? "", /text\/javascript/);
  assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
  const head = await fetch(base, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert(Number(head.headers.get("content-length")) > 0);
  assert.equal((await fetch(base, { method: "POST" })).status, 405);
});

test("rejects raw/encoded traversal, hidden files, backslashes and malformed paths", async (t) => {
  const { webRoot } = await fixture(t);
  const base = await listen(t, createAppServer({ webRoot }));
  for (const path of [
    "/assets/../../private.js",
    "/assets/%2e%2e/%2e%2e/private.js",
    "/assets/..%2f..%2fprivate.js",
    "/assets/%5c..%5cprivate.js",
    "/.env",
    "/assets/.env",
    "/assets/%00.js",
    "/assets/%zz.js",
  ]) {
    const response = await rawGet(base, path);
    assert.equal(response.status, 400, path);
    assert(!response.body.includes("PRIVATE"));
  }
});

test("does not follow asset directory symlinks outside the build root", async (t) => {
  const { directory, webRoot } = await fixture(t);
  // Windows directory junctions need no elevated symlink privilege.
  await symlink(
    directory,
    join(webRoot, "assets", "outside"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const base = await listen(t, createAppServer({ webRoot }));
  const response = await fetch(`${base}/assets/outside/private.js`);
  assert.equal(response.status, 404);
  assert(!(await response.text()).includes("PRIVATE"));
});

test("health works without a frontend build", async (t) => {
  const base = await listen(t, createAppServer());
  assert.equal((await fetch(base)).status, 404);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
