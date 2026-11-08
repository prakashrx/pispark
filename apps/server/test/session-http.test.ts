import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { messagePage, messageWindow } from "../src/runtime/message-window.js";
import { SessionRuntime } from "../src/runtime/session-runtime.js";
import { SessionHttp } from "../src/session-http.js";
import { createAppServer } from "../src/server.js";
import { bundledTransportPatched } from "../src/host-configuration.js";
import { LocalProviderControl, eventually } from "./fixtures/local-provider.js";
import type { Receipt, SnapshotEvent } from "../src/protocol.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pispark-http-"));
  await mkdir(join(root, "a"));
  await mkdir(join(root, "b"));
  const provider = new LocalProviderControl();
  const configuration = {
    storageDir: join(root, "state"),
    workspaces: { a: join(root, "a"), b: join(root, "b") },
    configurations: {
      local: {
        modelId: "deterministic",
        provider: provider.provider,
        credential: { local: true as const },
        systemPrompt: "test only",
        tools: [],
        extensions: [] as string[],
      },
    },
    resolveSecret: async () => undefined,
  };
  const runtime = new SessionRuntime(configuration);
  const http = new SessionHttp(runtime, { workspaces: [], configurations: [] });
  const server = createAppServer({ sessions: http });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await http.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const post = async (command: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ commandId: randomUUID(), ...command }),
    });
    assert.equal(response.status, 202);
    return (await response.json()) as Receipt;
  };
  const settle = async (receipt: Receipt) => {
    while (receipt.state === "accepted") {
      await new Promise((r) => setTimeout(r, 5));
      receipt = (await (
        await fetch(`${base}/api/receipts/${receipt.commandId}`)
      ).json()) as Receipt;
    }
    return receipt;
  };
  const create = async (workspace: string) => {
    const r = await settle(
      await post({ type: "create", workspace, configuration: "local" }),
    );
    assert.equal(r.outcome, "completed");
    return r.sessionId!;
  };
  return {
    root,
    base,
    runtime,
    http,
    provider,
    post,
    settle,
    create,
    configuration,
  };
}
async function observe(base: string, id: string) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/sessions/${id}/events`, {
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const events: SnapshotEvent[] = [];
  const reader = response.body!.getReader();
  let pending = "";
  const decoder = new TextDecoder();
  const reading = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          events.push(JSON.parse(frame.split("data: ")[1]!));
        }
      }
    } catch {
      /* explicit disconnect */
    }
  })();
  return {
    events,
    close: async () => {
      controller.abort();
      await reading;
    },
  };
}

test("SessionHttp: actual concurrent SDK execution, correlated acceptance/settlement, snapshot race, disconnect/cancel/queue isolation and restart history", async (t) => {
  const f = await fixture(t);
  const a = await f.create("a");
  const b = await f.create("b");
  const stream = await observe(f.base, a);
  const runA = await f.post({ type: "start", sessionId: a, text: "alpha" });
  const runB = await f.post({ type: "start", sessionId: b, text: "beta" });
  assert.equal(runA.state, "accepted");
  await eventually(() => f.provider.active === 2);
  await eventually(() => stream.events.some((event) => event.snapshot.partial));
  assert.equal(stream.events[0]!.boundary, "initial");
  for (let i = 1; i < stream.events.length; i++)
    assert(stream.events[i]!.sequence > stream.events[i - 1]!.sequence);
  await stream.close();
  assert.equal(f.provider.active, 2);
  const reconnected = await observe(f.base, a);
  await eventually(() => reconnected.events.length > 0);
  assert.equal(reconnected.events[0]!.snapshot.status, "running");
  assert(reconnected.events[0]!.snapshot.partial);
  const queued = await f.settle(
    await f.post({ type: "follow-up", sessionId: a, text: "queued" }),
  );
  assert.equal(queued.outcome, "queued");
  await f.settle(await f.post({ type: "cancel", sessionId: a }));
  assert.equal((await f.settle(runA)).outcome, "cancelled");
  assert.deepEqual(f.runtime.window(a).queue, { steering: 0, followUp: 0 });
  assert.equal(f.provider.active, 1);
  f.provider.requests[1]!.release();
  assert.equal((await f.settle(runB)).outcome, "completed");
  await reconnected.close();
  await f.http.shutdown();
  const reopened = new SessionRuntime(f.configuration);
  await reopened.open(b);
  assert.match(JSON.stringify(reopened.window(b)), /local:beta/);
  assert.equal(f.provider.requests.length, 2);
  await reopened.shutdown();
});

test("SessionHttp: strict Host/Origin/JSON/identity, explicit failures, receipts are idempotent while retained", async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { Origin: "http://evil.invalid" },
    { Origin: "null" },
    { Host: "evil.invalid" },
    { "Sec-Fetch-Site": "cross-site" },
  ] as Record<string, string>[]) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${f.base}/api/catalog`, { headers }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  for (const payload of [
    {},
    {
      commandId: randomUUID(),
      type: ["start"],
      sessionId: randomUUID(),
      text: "invalid discriminator",
    },
    { commandId: randomUUID(), type: "open", sessionId: "/etc/passwd" },
    {
      commandId: randomUUID(),
      type: "create",
      workspace: "a",
      configuration: "local",
      apiKey: "NEVER",
    },
    {
      commandId: randomUUID(),
      type: "start",
      sessionId: randomUUID(),
      text: "x".repeat(80_000),
    },
  ]) {
    const response = await fetch(`${f.base}/api/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 400);
  }
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded"])
    assert.equal(
      (
        await fetch(`${f.base}/api/commands`, {
          method: "POST",
          headers: { "Content-Type": contentType },
          body: "{}",
        })
      ).status,
      400,
    );
  const bad = await f.settle(
    await f.post({
      type: "create",
      workspace: "missing",
      configuration: "local",
    }),
  );
  assert.equal(bad.error, "configuration");
  const command = {
    commandId: randomUUID(),
    type: "create",
    workspace: "a",
    configuration: "local",
  };
  const first = await f.settle(await f.post(command));
  const second = await f.settle(await f.post(command));
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(f.runtime.list().length, 1);
  assert.equal(
    (await fetch(`${f.base}/api/receipts/${randomUUID()}`)).status,
    404,
  );
  const id = first.sessionId!;
  f.provider.automatic = true;
  const failed = await f.settle(
    await f.post({ type: "start", sessionId: id, text: "provider-error" }),
  );
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.error, "execution");
  assert.equal(
    (
      await f.settle(
        await f.post({ type: "start", sessionId: id, text: "again" }),
      )
    ).error,
    "busy",
  );
});

test("message pages redact credentials across cursor boundaries and keep emoji intact", () => {
  const secret = "private-token";
  const content = "x".repeat(8190) + secret + "tail";
  const first = messagePage({ content }, secret, 0, 0);
  assert.equal(first.text, "x".repeat(8190) + "[redacted]");
  assert(first.next);
  assert.equal(messagePage({ content }, secret, 0, first.next.offset).text, "tail");
  assert.equal(messagePage({ content }, secret, 0, 8194).text, "[redacted]tail");
  const emoji = { content: "x".repeat(8191) + "🌱" };
  const initial = messagePage(emoji, undefined, 0, 0);
  assert.equal(initial.next?.offset, 8191);
  assert.equal(messagePage(emoji, undefined, 0, 8191).text, "🌱");
  const budget = { remaining: 4, truncated: false };
  messageWindow({ content: "x" }, "x", budget);
  assert(budget.truncated);
});

test("a bad metadata record is counted and a rejected new chat is never published", async (t) => {
  const f = await fixture(t);
  const rejected = new SessionRuntime({
    ...f.configuration,
    configurations: { missing: { ...f.configuration.configurations.local, credential: { secretRef: "missing" } } },
  });
  await assert.rejects(rejected.create({ workspace: "a", configuration: "missing" }));
  await rejected.shutdown();
  const id = await f.create("a");
  const damaged = join(f.configuration.storageDir, randomUUID());
  await mkdir(damaged);
  await writeFile(join(damaged, "host.json"), "{");
  const list = await (await fetch(f.base + "/api/sessions")).json();
  assert.equal(list.unreadable, 1);
  assert.deepEqual(list.sessions.map((s: { id: string }) => s.id), [id]);
  await f.runtime.stop(id);
  const fail = await f.post({ type: "start", sessionId: id, text: "never sent" });
  assert.equal(fail.state, "settled");
  assert.equal(fail.error, "not-found");
  assert.equal(f.provider.requests.length, 0);
});

test("SessionHttp: bounded native windows, long stream/coalescing and blocked writable cleanup", async (t) => {
  const f = await fixture(t);
  const id = await f.create("a");
  f.provider.automatic = true;
  for (let i = 0; i < 15; i++)
    await f.runtime.start(id, "x".repeat(60_000)).completion;
  const window = f.runtime.window(id);
  // The text budget runs out before 20 messages: the window stops there instead of
  // sending older messages with empty text, and "Load older" picks them up.
  assert(window.messages.length > 0 && window.messages.length < 20);
  assert.equal(window.before, window.total - window.messages.length);
  assert(window.truncated);
  assert(window.messages.every((m) => m.parts.some((p) => p.text)));
  const newest = window.messages.at(-1)!;
  assert.equal(newest.role, "assistant");
  assert.match(newest.parts[0]!.text, /^local:/);
  assert(window.messages.every((m) => m.role && m.parts.every((p) => p.type)));
  assert(newest.detail);
  const path = `${f.base}/api/sessions/${id}/messages/${newest.detail.index}/${newest.detail.key}`;
  let cursor: { part: number; offset: number } | undefined = { part: 0, offset: 0 };
  let complete = "";
  while (cursor) {
    const response: Response = await fetch(`${path}/${cursor.part}/${cursor.offset}`);
    assert.equal(response.status, 200);
    const page: import("../src/protocol.js").MessagePage = await response.json();
    assert(page.text.length <= 8192);
    complete += page.text;
    cursor = page.next;
  }
  assert.equal(complete, "local:" + "x".repeat(60_000));
  assert(Buffer.byteLength(JSON.stringify(window)) < 256 * 1024);
  const older = (await (
    await fetch(`${f.base}/api/sessions/${id}/window?before=${window.before}`)
  ).json()) as { messages: unknown[]; before: number };
  assert(older.messages.length > 0);
  assert.equal(older.before, window.before - older.messages.length);
  // Deliberately non-draining socket boundary. Real SDK continues independently while one bounded frame waits.
  class Blocked extends EventEmitter {
    headersSent = false;
    destroyed = false;
    writableEnded = false;
    writes = 0;
    bytes = 0;
    writeHead() {
      this.headersSent = true;
    }
    write(value: string) {
      this.writes++;
      this.bytes += Buffer.byteLength(value);
      return false;
    }
    destroy() {
      this.destroyed = true;
      this.emit("close");
    }
    end() {
      this.writableEnded = true;
      this.emit("close");
    }
  }
  const response = new Blocked();
  // SAFETY: only these HTTP members are used by handle/observe; this is a deliberately blocked transport fixture.
  const requestFixture = {
    url: `/api/sessions/${id}/events`,
    method: "GET",
    headers: { host: "127.0.0.1:1234" },
    socket: { localAddress: "127.0.0.1", localPort: 1234 },
  } as unknown as IncomingMessage;
  // SAFETY: fixture implements the writable/event surface used by SessionHttp.
  const handling = f.http.handle(
    requestFixture,
    response as unknown as ServerResponse,
  );
  await eventually(() => response.writes === 1);
  for (let i = 0; i < 50; i++)
    await f.runtime.start(id, `burst${i}`).completion;
  assert.equal(response.writes, 1);
  assert(response.bytes < 256 * 1024);
  await handling;
  assert(response.destroyed);
  // Observer was released, not the runtime. Reconnect returns current finalized state.
  const stream = await observe(f.base, id);
  await eventually(() => stream.events.length > 0);
  assert.match(JSON.stringify(stream.events[0]), /local:burst49/);
  await stream.close();
});

test("SessionHttp: real token burst is coalesced, bounded and terminal settlement survives", async (t) => {
  const f = await fixture(t);
  const id = await f.create("a");
  const stream = await observe(f.base, id);
  const receipt = await f.post({
    type: "start",
    sessionId: id,
    text: "burst-stream",
  });
  await eventually(() => f.provider.requests.length === 1);
  const start = performance.now();
  const heap = process.memoryUsage().heapUsed;
  for (let batch = 0; batch < 20; batch++) {
    for (let n = 0; n < 500; n++)
      f.provider.requests[0]!.pushText("delta".repeat(10));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await eventually(() => f.runtime.window(id).truncated);
  const elapsed = performance.now() - start;
  assert(
    stream.events.length < 20,
    "10000 native events must not become10000 serialized frames",
  );
  assert(
    stream.events.every(
      (event) => Buffer.byteLength(JSON.stringify(event)) < 256 * 1024,
    ),
  );
  f.provider.requests[0]!.release();
  assert.equal((await f.settle(receipt)).outcome, "completed");
  await eventually(() => stream.events.at(-1)?.snapshot.status === "idle");
  console.log(
    JSON.stringify({
      probe: "10000-token-events",
      milliseconds: Math.round(elapsed),
      heapDeltaBytes: process.memoryUsage().heapUsed - heap,
      frames: stream.events.length,
      maxFrameBytes: Math.max(
        ...stream.events.map((e) => Buffer.byteLength(JSON.stringify(e))),
      ),
    }),
  );
  await stream.close();
});

test("SessionHttp: observer admission releases on disconnect, receipt expiry is explicitly unknown", async (t) => {
  const f = await fixture(t);
  const id = await f.create("a");
  const streams = await Promise.all(
    Array.from({ length: 16 }, () => observe(f.base, id)),
  );
  assert.equal(
    (await fetch(`${f.base}/api/sessions/${id}/events`)).status,
    400,
  );
  await streams[0]!.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const replacement = await observe(f.base, id);
  await replacement.close();
  await Promise.all(streams.slice(1).map((stream) => stream.close()));
  const receipt = await f.settle(
    await f.post({ type: "cancel", sessionId: id }),
  );
  const now = Date.now;
  Date.now = () => now() + 601_000;
  try {
    assert.equal(
      (await fetch(`${f.base}/api/receipts/${receipt.commandId}`)).status,
      404,
    );
  } finally {
    Date.now = now;
  }
});

test("bundledTransportPatched: numeric patched branches and unknown/prerelease fail closed", () => {
  for (const version of [
    "6.28.0",
    "6.29.0",
    "7.30.0",
    "8.12.1",
    "8.9.99",
    "5.99.0",
    "8.12.2-rc.1",
    undefined,
  ])
    assert.equal(bundledTransportPatched(version), false, version);
  for (const version of [
    "6.29.1",
    "6.30.0",
    "7.30.1",
    "8.12.2",
    "8.13.0",
    "9.0.0",
  ])
    assert.equal(bundledTransportPatched(version), true, version);
});

for (const boundary of ["retained", "pending"] as const) {
  test(`SessionHttp: lifecycle remains available at ordinary ${boundary} saturation and coalesces bounded controls`, async (t) => {
    const f = await fixture(t);
    let release!: () => void;
    if (boundary === "pending") {
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const key = `pispark-http-input:${f.root}`;
      const globals = globalThis as unknown as Record<string, unknown>;
      globals[key] = () => gate;
      const path = join(f.root, "pending-input.mjs");
      await writeFile(
        path,
        `export default pi => pi.on('input', async event => { if(event.text === 'pending') await globalThis[${JSON.stringify(key)}](); return {action:'continue'}; });`,
      );
      f.configuration.configurations.local.extensions = [path];
      t.after(() => {
        release();
        delete globals[key];
      });
    }
    const ids: string[] = [];
    for (let i = 0; i < (boundary === "pending" ? 8 : 1); i++)
      ids.push(await f.create("a"));
    if (boundary === "retained") {
      for (let i = 0; i < 254; i++)
        await f.settle(await f.post({ type: "open", sessionId: ids[0] }));
    }
    for (const id of ids)
      await f.post({ type: "start", sessionId: id, text: "hold" });
    await eventually(() => f.provider.active === ids.length);
    if (boundary === "pending") {
      for (const id of ids)
        await f.post({ type: "steer", sessionId: id, text: "pending" });
    }
    const overflow = await fetch(`${f.base}/api/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commandId: randomUUID(),
        type: "start",
        sessionId: ids[0],
        text: "overflow",
      }),
    });
    assert.equal(overflow.status, 400);
    const cancel = await f.post({ type: "cancel", sessionId: ids[0] });
    const stop = await f.post({ type: "stop", sessionId: ids.at(-1) });
    release?.();
    assert.equal((await f.settle(cancel)).outcome, "completed");
    assert.equal((await f.settle(stop)).outcome, "completed");
  });
}

test("SessionHttp: repeated pending lifecycle controls share a retained canonical receipt and reserve is bounded", async (t) => {
  const f = await fixture(t);
  const id = await f.create("a");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = f.runtime.cancel.bind(f.runtime);
  let calls = 0;
  t.mock.method(f.runtime, "cancel", async (id: string) => {
    calls++;
    await gate;
    return original(id);
  });
  const first = await f.post({ type: "cancel", sessionId: id });
  for (let i = 0; i < 300; i++) {
    const repeat = await f.post({ type: "cancel", sessionId: id });
    assert.equal(repeat.commandId, first.commandId);
  }
  assert.equal(calls, 1);
  release();
  assert.equal((await f.settle(first)).outcome, "completed");
  for (let i = 0; i < 31; i++)
    await f.settle(await f.post({ type: "stop", sessionId: randomUUID() }));
  const response = await fetch(`${f.base}/api/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commandId: randomUUID(),
      type: "cancel",
      sessionId: id,
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error: string }).error, "limit");
  // Lifecycle flooding cannot consume ordinary admission or evict accepted receipts.
  await f.create("b");
  assert.equal(
    (await fetch(`${f.base}/api/receipts/${first.commandId}`)).status,
    200,
  );
});
