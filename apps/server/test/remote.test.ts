import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deviceName, validPairRequest, validRemoteAction } from "../src/contract/remote-protocol.js";
import { PAIRING_MS, RemoteDevices } from "../src/core/remote/devices.js";
import { RemoteAccess, addressFor } from "../src/core/remote/remote-access.js";
import type { ServeResult, TailscaleCli } from "../src/core/remote/tailscale.js";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { SessionHttp } from "../src/http/session-http.js";
import { createAppServer } from "../src/http/server.js";
import { localProviderSettings } from "./fixtures/provider-settings.js";

test("remote actions and pair requests: only the known shapes pass", () => {
  assert.deepEqual(validRemoteAction({ action: "on" }), { action: "on" });
  assert.deepEqual(validRemoteAction({ action: "remove", device: "a-1" }), { action: "remove", device: "a-1" });
  for (const bad of [null, [], { action: "on", x: 1 }, { action: "remove" }, { action: "remove", device: "../x" }, { action: "reset" }])
    assert.equal(validRemoteAction(bad), undefined, JSON.stringify(bad));
  assert.deepEqual(validPairRequest({ code: "012345", name: "  My   phone " }), { code: "012345", name: "My phone" });
  for (const bad of [
    { code: "12345", name: "a" },
    { code: "123456" },
    { code: "123456", name: "" },
    { code: "123456", name: "a\u0007" },
    { code: "123456", name: "x".repeat(61) },
    { code: "123456", name: "a", more: 1 },
  ])
    assert.equal(validPairRequest(bad), undefined, JSON.stringify(bad));
  assert.equal(deviceName(5), undefined);
});

test("the address: plain for port 3000, the install's own port otherwise", () => {
  assert.equal(addressFor("desk.tail0.ts.net", 3000), "https://desk.tail0.ts.net");
  assert.equal(addressFor("desk.tail0.ts.net", 3100), "https://desk.tail0.ts.net:3100");
});

test("pairing: a code works once, expires, and a few wrong tries end it; tokens are stored hashed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-devices-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "remote.json");
  let now = Date.parse("2026-11-15T10:00:00Z");
  const devices = new RemoteDevices(file, () => now);
  assert.throws(() => devices.pair("000000", "x"), { code: "not-found" });

  const { code } = devices.startPairing();
  const { device, token } = devices.pair(code, "Phone");
  assert.equal(device.name, "Phone");
  assert.throws(() => devices.pair(code, "Again"), { code: "not-found" });
  assert.ok(!readFileSync(file, "utf8").includes(token), "the token itself is never written");
  assert.equal(devices.device(token)?.id, device.id);
  assert.equal(devices.device("x".repeat(43)), undefined);
  // Still known after a restart.
  assert.equal(new RemoteDevices(file, () => now).device(token)?.id, device.id);

  const second = devices.startPairing().code;
  const wrong = second === "999999" ? "999998" : "999999";
  for (let i = 0; i < 5; i++) assert.throws(() => devices.pair(wrong, "Guess"), { code: "invalid-input" });
  assert.throws(() => devices.pair(second, "Late"), { code: "not-found" }, "five wrong tries end the code");

  const third = devices.startPairing().code;
  now += PAIRING_MS;
  assert.equal(devices.currentPairing(), undefined);
  assert.throws(() => devices.pair(third, "Expired"), { code: "not-found" });

  devices.remove(device.id);
  assert.equal(devices.device(token), undefined);
  assert.deepEqual(devices.list(), []);
  // An unreadable file is off with no devices.
  writeFileSync(file, "{nope");
  assert.deepEqual(new RemoteDevices(file).list(), []);
  assert.equal(new RemoteDevices(file).address, undefined);
});

/** Tailscale as the tests need it: signed in, serving whatever it was last told to. */
class FakeTailscale implements TailscaleCli {
  served?: string;
  next: ServeResult = { ok: true };
  async info() {
    return { state: { state: "ready" as const, account: "me@example.com", machine: "desk" }, dnsName: "desk.tail0.ts.net" };
  }
  async serving(dnsName: string, port: number, target: string) {
    return this.served === `${dnsName}:${port} ${target}`;
  }
  async serve(port: number, target: string) {
    if (this.next.ok) this.served = `desk.tail0.ts.net:${port} ${target}`;
    return this.next;
  }
  async stop() {
    this.served = undefined;
  }
}

test("remote access: only paired devices at the address, managed only from this computer", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pispark-remote-http-"));
  const f = await localProviderSettings(root);
  const runtime = new SessionRuntime({ home: join(root, "pispark") }, f.settings);
  const cli = new FakeTailscale();
  const handlers = new SessionHttp(runtime, undefined, undefined, undefined, undefined, new RemoteAccess(join(root, "remote.json"), cli));
  const server = createAppServer({ sessions: handlers });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  t.after(async () => {
    await handlers.shutdown();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  });
  const remoteHost = `desk.tail0.ts.net:${port}`;
  const call = (
    path: string,
    options: { host?: string; origin?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    new Promise<{ status: number; body: any; cookie?: string }>((resolve, reject) => {
      const data = options.body === undefined ? undefined : JSON.stringify(options.body);
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path,
          method: data ? "POST" : "GET",
          headers: {
            Host: options.host ?? `127.0.0.1:${port}`,
            ...(options.origin ? { Origin: options.origin } : {}),
            ...(options.cookie ? { Cookie: options.cookie } : {}),
            ...options.headers,
            ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          },
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () =>
            resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : undefined, cookie: res.headers["set-cookie"]?.[0] }),
          );
        },
      );
      req.on("error", reject);
      req.end(data);
    });
  const local = `http://127.0.0.1:${port}`;
  const remote = { host: remoteHost, origin: `https://${remoteHost}` };

  // Off: the remote address is refused like any other Host.
  assert.equal((await call("/api/sessions", remote)).status, 403);
  let status = (await call("/api/remote")).body;
  assert.equal(status.on, false);
  assert.equal(status.address, `https://${remoteHost}`);
  assert.deepEqual(status.tailscale, { state: "ready", account: "me@example.com", machine: "desk" });

  // Serve not allowed on the tailnet: the admin link, still off.
  cli.next = { ok: false, enableUrl: "https://login.tailscale.com/f/serve?node=abc" };
  status = (await call("/api/remote", { origin: local, body: { action: "on" } })).body;
  assert.equal(status.on, false);
  assert.equal(status.enableUrl, "https://login.tailscale.com/f/serve?node=abc");
  assert.equal((await call("/api/sessions", remote)).status, 403);

  cli.next = { ok: true };
  status = (await call("/api/remote", { origin: local, body: { action: "on" } })).body;
  assert.equal(status.on, true);
  assert.equal(status.enableUrl, undefined);
  assert.equal(cli.served, `desk.tail0.ts.net:${port} http://127.0.0.1:${port}`);

  // On, unpaired: only "what am I" and pairing.
  assert.deepEqual((await call("/api/sessions", remote)).body, { error: "unpaired" });
  assert.equal((await call("/api/sessions", remote)).status, 401);
  assert.deepEqual((await call("/api/remote/me", remote)).body, { remote: true });
  assert.deepEqual((await call("/api/remote/me")).body, { remote: false });
  // The address over plain HTTP, or from another site, is refused.
  assert.equal((await call("/api/remote/me", { host: remoteHost, origin: `http://${remoteHost}` })).status, 403);
  assert.equal((await call("/api/remote/me", { host: remoteHost, origin: "https://example.com" })).status, 403);

  // No code yet; then a code from this computer.
  assert.equal((await call("/api/remote/pair", { ...remote, body: { code: "123456", name: "Phone" } })).status, 403);
  status = (await call("/api/remote", { origin: local, body: { action: "pair" } })).body;
  const code: string = status.pairing.code;
  assert.match(code, /^\d{6}$/);
  assert.equal(status.pairing.url, `https://${remoteHost}/pair#${code}`);
  const wrong = code === "000000" ? "000001" : "000000";
  assert.equal((await call("/api/remote/pair", { ...remote, body: { code: wrong, name: "Phone" } })).status, 403);
  const paired = await call("/api/remote/pair", { ...remote, body: { code, name: "Phone" } });
  assert.equal(paired.status, 201);
  assert.equal(paired.body.device.name, "Phone");
  assert.match(paired.cookie!, new RegExp(`^__Host-pispark-${port}=[\\w-]{43}; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Strict$`));
  const cookie = paired.cookie!.split(";")[0]!;
  assert.equal((await call("/api/remote/pair", { ...remote, body: { code, name: "Again" } })).status, 403, "a code works once");

  // Paired: the app works; the settings don't.
  assert.equal((await call("/api/sessions", { ...remote, cookie })).status, 200);
  assert.equal((await call("/api/remote", { ...remote, cookie })).status, 403);
  assert.equal((await call("/api/remote", { ...remote, cookie, body: { action: "pair" } })).status, 403);
  const me = await call("/api/remote/me", { ...remote, cookie });
  assert.equal(me.body.device.name, "Phone");
  assert.ok(me.cookie?.startsWith(cookie), "opening the app renews the cookie");
  status = (await call("/api/remote")).body;
  assert.equal(status.devices.length, 1);
  assert.ok(status.devices[0].lastUsed);

  // Removed: its access ends at once.
  await call("/api/remote", { origin: local, body: { action: "remove", device: status.devices[0].id } });
  assert.equal((await call("/api/sessions", { ...remote, cookie })).status, 401);

  // Off: PiSpark refuses the address and Tailscale stops serving it.
  status = (await call("/api/remote", { origin: local, body: { action: "off" } })).body;
  assert.equal(status.on, false);
  assert.equal(cli.served, undefined);
  assert.equal((await call("/api/remote/me", remote)).status, 403);
  // This computer is unaffected throughout.
  assert.equal((await call("/api/sessions")).status, 200);
  // A forwarded request is never this computer, even with a loopback Host.
  assert.equal((await call("/api/sessions", { headers: { "X-Forwarded-For": "100.64.0.2" } })).status, 403);
  assert.equal((await call("/api/sessions", { headers: { "Tailscale-User-Login": "me@example.com" } })).status, 403);
});
