import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, validHostAction } from "../src/contract/host-protocol.js";
import { HOME_FORMAT, prepareHome } from "../src/core/home.js";
import { HostLink } from "../src/core/host-link.js";
import { HostHttp } from "../src/http/host-http.js";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { SessionHttp } from "../src/http/session-http.js";
import { createAppServer } from "../src/http/server.js";
import { localProviderSettings } from "./fixtures/provider-settings.js";

test("versions order as releases do: numbers, then a release after its prereleases", () => {
  const sorted = ["0.4.3", "0.4.2", "0.4.3-main.10", "0.10.0", "0.4.3-main.9", "v0.4.1"].sort(compareVersions);
  assert.deepEqual(sorted, ["v0.4.1", "0.4.2", "0.4.3-main.9", "0.4.3-main.10", "0.4.3", "0.10.0"]);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
});

test("host actions: only the known shapes pass", () => {
  assert.deepEqual(validHostAction({ action: "check" }), { action: "check" });
  assert.deepEqual(validHostAction({ action: "apply", when: "idle" }), { action: "apply", when: "idle" });
  assert.deepEqual(validHostAction({ action: "configure", channel: "latest" }), { action: "configure", channel: "latest" });
  assert.deepEqual(validHostAction({ action: "configure", autoUpdate: true }), { action: "configure", autoUpdate: true });
  for (const bad of [null, [], { action: "apply" }, { action: "apply", when: "later" }, { action: "check", extra: 1 }, { action: "configure", channel: "beta" }, { action: "configure", autoUpdate: "yes" }, { action: "delete" }])
    assert.equal(validHostAction(bad), undefined, JSON.stringify(bad));
});

test("data folder layout: recorded on first start, kept, and a newer one refused", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-format-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = prepareHome(join(root, "data"));
  const file = join(paths.root, "home.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { format: HOME_FORMAT });
  prepareHome(paths.root);
  writeFileSync(file, JSON.stringify({ format: HOME_FORMAT + 1 }));
  assert.throws(() => prepareHome(paths.root), /written by a newer PiSpark/);
  writeFileSync(file, "{not json");
  assert.throws(() => prepareHome(paths.root), /cannot be read/);
});

test("/api/host: version and what runs; changes refused when no launcher runs this server", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-host-http-"));
  const f = await localProviderSettings(root);
  const runtime = new SessionRuntime({ home: join(root, "pispark") }, f.settings);
  const link = new HostLink(() => runtime.runningWork(), () => {});
  const handlers = new SessionHttp(runtime, undefined, undefined, undefined, new HostHttp(link, join(root, "pispark"), () => runtime.runningWork()));
  const server = createAppServer({ sessions: handlers });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await handlers.shutdown();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  });
  const status = await (await fetch(`${origin}/api/host`)).json();
  assert.equal(status.managed, false);
  assert.equal(status.version, "development");
  assert.equal(status.address, origin);
  assert.deepEqual(status.running, { replies: [], processes: [] });
  const post = (body: unknown) => fetch(`${origin}/api/host`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
  assert.equal((await post({ action: "check" })).status, 409);
  assert.equal((await post({ action: "nope" })).status, 400);
  // Another site may not drive it.
  const cross = await fetch(`${origin}/api/host`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" }, body: "{}" });
  assert.equal(cross.status, 403);
});
