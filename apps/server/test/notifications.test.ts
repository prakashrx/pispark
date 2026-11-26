import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicKey, verify } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PushKeys, validEndpoint } from "../src/http/push.js";
import { Notifications } from "../src/http/notifications.js";
import type { SessionInfo } from "../src/contract/protocol.js";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const PHONE = "https://web.push.apple.com/QK123";

test("VAPID: the token names only the push service's origin and verifies with the public key; keys are kept", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pispark-push-"));
  try {
    const keys = new PushKeys(join(folder, "vapid.pem"));
    const header = keys.authorization(ENDPOINT, Date.UTC(2026, 10, 18));
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    assert.equal(key, keys.publicKey);
    const [head, claims, signature] = token!.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(head!, "base64url").toString()), { typ: "JWT", alg: "ES256" });
    const body = JSON.parse(Buffer.from(claims!, "base64url").toString());
    assert.equal(body.aud, "https://fcm.googleapis.com");
    assert.equal(body.exp, Date.UTC(2026, 10, 18) / 1000 + 12 * 60 * 60);
    const raw = Buffer.from(keys.publicKey, "base64url");
    assert.equal(raw.length, 65);
    const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
    assert.ok(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url")));
    // The same keys next time; the private key is never in what a browser gets.
    assert.equal(new PushKeys(join(folder, "vapid.pem")).publicKey, keys.publicKey);
    assert.match(await readFile(join(folder, "vapid.pem"), "utf8"), /PRIVATE KEY/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("push endpoints are the browsers' push services only", () => {
  for (const good of [ENDPOINT, PHONE, "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"])
    assert.ok(validEndpoint(good), good);
  for (const bad of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com:8443/x", "https://u:p@fcm.googleapis.com/x", 7])
    assert.ok(!validEndpoint(bad), String(bad));
});

const session = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  folder: "/w",
  createdAt: "2026-11-18T00:00:00.000Z",
  lastActivity: "2026-11-18T00:00:00.000Z",
  status: "idle",
  interrupted: false,
  agent: { id: "default", name: "Default", layered: false },
  title: `Session ${id}`,
  ...extra,
});

test("a device is told what newly happened, as it asked, unless PiSpark is in view there; a gone subscription is dropped", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pispark-notify-"));
  let sessions = [session("a"), session("b"), session("c")];
  let now = Date.UTC(2026, 10, 18, 9);
  const pushed: string[] = [];
  let status = 201;
  const fetcher = (async (url: string) => {
    pushed.push(url);
    return new Response(null, { status });
  }) as typeof fetch;
  try {
    const n = new Notifications(folder, () => sessions, fetcher, () => now);
    n.subscribe("phone", PHONE, ["needs-you", "failed", "finished", "schedule-failed"]);
    n.subscribe("local", ENDPOINT, ["failed"]);
    n.sessionsChanged(); // how things are now: nothing is told

    // a starts needing you: only the phone asked for that.
    sessions = [session("a", { status: "running", waiting: true, question: "Overwrite package.json?" }), session("b"), session("c")];
    n.sessionsChanged();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(pushed, [PHONE]);
    assert.deepEqual(n.take("local", PHONE), [], "another device can't read the phone's");
    assert.deepEqual(n.take("phone", PHONE), [{ title: "Session a", body: "Needs you: Overwrite package.json?", url: "/#/s/a", tag: "a:needs-you" }]);
    assert.deepEqual(n.take("phone", PHONE), [], "read once");

    // A long run finishes and another fails, while PiSpark is in view on the phone: only this computer hears of the failure.
    sessions = [session("a", { status: "running", waiting: true }), session("b", { status: "running", workingSince: new Date(now - 5 * 60_000).toISOString() }), session("c", { status: "running" })];
    n.sessionsChanged();
    n.present("phone", "page-1", true);
    sessions = [session("a", { status: "running", waiting: true }), session("b", { status: "idle" }), session("c", { status: "error" })];
    pushed.length = 0;
    n.sessionsChanged();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(pushed, [ENDPOINT]);
    assert.deepEqual(n.take("local", ENDPOINT).map((each) => each.body), ["The run failed"]);

    // Out of view (the page's word expires), a scheduled run fails and the phone's subscription is gone.
    now += 2 * 60_000;
    sessions = [session("a", { status: "running", waiting: true }), session("b"), session("c", { status: "running", schedule: { id: "s", due: "x" } })];
    n.sessionsChanged();
    sessions = [session("a", { status: "running", waiting: true }), session("b"), session("c", { status: "error", schedule: { id: "s", due: "x" } })];
    pushed.length = 0;
    status = 410;
    n.sessionsChanged();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(pushed, [PHONE]);
    assert.equal(n.state("phone", PHONE).subscribed, false, "dropped when the push service says it's gone");
    assert.equal(n.state("local", ENDPOINT).subscribed, true);
    // Only the device that subscribed an endpoint can test it, see it or remove it.
    assert.equal(await n.test("phone", ENDPOINT), false);
    assert.equal(n.state("phone", ENDPOINT).subscribed, false);
    n.unsubscribe("phone", ENDPOINT);
    assert.equal(n.state("local", ENDPOINT).subscribed, true);

    // A removed device takes its subscriptions along; they are saved.
    n.subscribe("phone", PHONE, ["needs-you"]);
    n.forgetDevice("phone");
    assert.equal(n.state("phone", PHONE).subscribed, false);
    assert.deepEqual(JSON.parse(await readFile(join(folder, "subscriptions.json"), "utf8")).map((each: { device: string }) => each.device), ["local"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
