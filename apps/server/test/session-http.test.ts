import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { observeLive } from "./fixtures/live-client.js";
import { SessionRuntime, type RuntimeConfiguration } from "../src/runtime/session-runtime.js";
import { SessionHttp } from "../src/session-http.js";
import { createAppServer } from "../src/server.js";
import { bundledTransportPatched } from "../src/host-configuration.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";
import type { ItemsPage, PartPage, Receipt } from "../src/protocol.js";

/** An ordinary Pi extension whose tool returns far more than a chat shows inline. */
const BIG = `
export default function (pi) {
  pi.registerTool({
    name: "big",
    label: "Big",
    description: "Returns a lot of text",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "y".repeat(200000) }], details: { rows: Array.from({ length: 3000 }, (_, i) => i) } };
    },
  });
}
`;
async function fixture(t: TestContext, extensions: Record<string, string> = {}, options: Partial<RuntimeConfiguration> = {}) {
  const h = await testHome("pispark-http-");
  const root = h.root;
  const folders = { a: await h.folder("a"), b: await h.folder("b") };
  await h.persona("default", { name: "Default" }, { "instructions/test.md": "test only", ...extensions });
  const provider = h.provider;
  const configuration = { ...h.configuration, ...options };
  const runtime = new SessionRuntime(configuration);
  const http = new SessionHttp(runtime);
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
  const create = async (folder: "a" | "b") => {
    const r = await settle(
      await post({ type: "create", folder: folders[folder] }),
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
    folders,
    home: h.home,
  };
}
const observe = observeLive;

test("SessionHttp: actual concurrent SDK execution, correlated acceptance/settlement, snapshot race, disconnect/cancel/queue isolation and restart history", async (t) => {
  const f = await fixture(t);
  const a = await f.create("a");
  const b = await f.create("b");
  const stream = await observe(f.base, a);
  const runA = await f.post({ type: "start", sessionId: a, text: "alpha" });
  const runB = await f.post({ type: "start", sessionId: b, text: "beta" });
  assert.equal(runA.state, "accepted");
  await eventually(() => f.provider.active === 2);
  await eventually(() => stream.state.doc?.tail.some((item) => item.role === "assistant") === true);
  assert.equal(stream.events[0]!.type, "snapshot");
  // Operations arrive in consecutive order (the helper asserts it) and only the tail streams.
  assert(stream.events.length > 1);
  await stream.close();
  assert.equal(f.provider.active, 2);
  const reconnected = await observe(f.base, a);
  await eventually(() => reconnected.events.length > 0);
  const initial = reconnected.events[0]!;
  assert(initial.type === "snapshot");
  assert.equal(initial.doc.session.status, "running");
  assert(initial.doc.tail.some((item) => item.role === "assistant"));
  const queued = await f.settle(
    await f.post({ type: "follow-up", sessionId: a, text: "queued" }),
  );
  assert.equal(queued.outcome, "queued");
  await f.settle(await f.post({ type: "cancel", sessionId: a }));
  assert.equal((await f.settle(runA)).outcome, "cancelled");
  assert.deepEqual(f.runtime.session(a).queue, { steering: 0, followUp: 0 });
  assert.equal(f.provider.active, 1);
  f.provider.requests[1]!.release();
  assert.equal((await f.settle(runB)).outcome, "completed");
  await reconnected.close();
  await f.http.shutdown();
  const reopened = new SessionRuntime(f.configuration);
  await reopened.open(b);
  assert.match(JSON.stringify(reopened.items(b, {})), /local:beta/);
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
      folder: "/tmp",
      apiKey: "NEVER",
    },
    { commandId: randomUUID(), type: "create", folder: "/tmp", persona: "../x" },
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
    await f.post({ type: "create", folder: join(f.root, "missing") }),
  );
  assert.equal(bad.error, "folder");
  const catalog = await (await fetch(`${f.base}/api/catalog`)).json();
  assert.equal(typeof catalog.home, "string");
  assert.deepEqual(catalog.recentFolders, []);
  const command = {
    commandId: randomUUID(),
    type: "create",
    folder: f.folders.a,
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

test("history is read from Pi's session: byte-bounded pages, cursors both ways, clipped text read in chunks", async (t) => {
  const f = await fixture(t, { "extensions/big.mjs": BIG });
  const id = await f.create("a");
  f.provider.automatic = true;
  await f.runtime.start(id, "tool:big:{}").completion;
  for (const word of ["a", "b", "c"]) await f.runtime.start(id, word).completion;
  const get = async <T>(query: string) => {
    const response = await fetch(`${f.base}/api/sessions/${id}/items${query}`);
    assert.equal(response.status, 200);
    return (await response.json()) as T;
  };
  // Newest first by cursor: each page is bounded, nothing is dropped, ids are Pi's entry ids.
  let page = await get<ItemsPage>("");
  const newest = page;
  assert(page.more && page.items.length >= 6 && page.items.length < 10, `${page.items.length} items, more=${page.more}`);
  assert(JSON.stringify(page).length < 1024 * 1024);
  const ids: string[] = [];
  for (;;) {
    ids.unshift(...page.items.map((item) => item.id!));
    if (!page.more) break;
    page = await get<ItemsPage>(`?before=${page.items[0]!.id}`);
  }
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, 10);
  // Forwards from any cursor reaches the same end.
  let forward: string[] = [];
  let after = ids[0]!;
  for (;;) {
    const next = await get<ItemsPage>(`?after=${after}`);
    forward.push(...next.items.map((item) => item.id!));
    if (!next.more) break;
    after = next.items.at(-1)!.id!;
  }
  assert.deepEqual(forward, ids.slice(1));
  assert.equal(newest.head, f.runtime.items(id, { limit: 1 }).head);
  // An overlong part arrives clipped with its full size, and is read whole in chunks.
  const result = (await get<ItemsPage>(`?after=${ids[1]}&limit=1`)).items[0]!;
  assert.equal(result.role, "toolResult");
  const part = result.parts[0]!;
  assert(part.type === "text" && part.size === 200_000 && part.text.length === 128 * 1024);
  // Pi's structured details are bounded, not dropped.
  assert.deepEqual(Object.keys(result.details as object), ["rows"]);
  assert.equal((result.details as { rows: unknown[] }).rows.length, 256);
  let complete = "";
  for (let offset: number | undefined = 0; offset !== undefined; ) {
    const chunk: PartPage = await (await fetch(`${f.base}/api/sessions/${id}/items/${result.id}/parts/0?offset=${offset}`)).json();
    assert(chunk.text.length <= 64 * 1024);
    complete += chunk.text;
    offset = chunk.next;
  }
  assert.equal(complete.length, part.size);
  assert.equal(complete, "y".repeat(200_000));
  // Bad input is refused, not guessed at.
  for (const query of ["?before=a&after=b", "?limit=abc", "?other=1", "?before=missing"])
    assert.equal((await fetch(`${f.base}/api/sessions/${id}/items${query}`)).status, 400, query);
  assert.equal((await fetch(`${f.base}/api/sessions/${id}/items/${result.id}/parts/0?x=1`)).status, 400);
});

test("a bad metadata record is counted and a rejected new chat is never published", async (t) => {
  const f = await fixture(t);
  const rejected = new SessionRuntime({
    ...f.configuration,
    fixedModel: { ...f.configuration.fixedModel!, id: "missing" },
  });
  await assert.rejects(rejected.create({ folder: f.folders.a }));
  await rejected.shutdown();
  const id = await f.create("a");
  const damaged = join(f.home, "chats", randomUUID());
  await mkdir(damaged);
  await writeFile(join(damaged, "chat.json"), "{");
  const list = await (await fetch(f.base + "/api/sessions")).json();
  assert.equal(list.unreadable, 1);
  assert.deepEqual(list.sessions.map((s: { id: string }) => s.id), [id]);
  await f.runtime.stop(id);
  const fail = await f.post({ type: "start", sessionId: id, text: "never sent" });
  assert.equal(fail.state, "settled");
  assert.equal(fail.error, "not-found");
  assert.equal(f.provider.requests.length, 0);
});

test("SessionHttp: long stream/coalescing and blocked writable cleanup", async (t) => {
  const f = await fixture(t);
  const id = await f.create("a");
  f.provider.automatic = true;
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
    url: `/api/sessions/${id}/live`,
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
  // The snapshot is small (only what is in flight) and names the head; history is read by cursor.
  const first = stream.events[0]!;
  assert(first.type === "snapshot");
  assert.equal(first.doc.tail.length, 0);
  const history = f.runtime.items(id, { limit: 4 });
  assert.equal(first.head, history.head);
  assert.match(JSON.stringify(history), /local:burst49/);
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
  // The live text is clipped at the part limit; what streams past it is not resent.
  await eventually(() => {
    const text = stream.state.doc?.tail[0]?.parts[0];
    return text?.type === "text" && (text.size ?? 0) > 0;
  });
  const elapsed = performance.now() - start;
  assert(
    stream.events.length < 40,
    "10000 native events must not become 10000 serialized frames",
  );
  assert(
    stream.events.every(
      (event) => Buffer.byteLength(JSON.stringify(event)) < 256 * 1024,
    ),
  );
  f.provider.requests[0]!.release();
  assert.equal((await f.settle(receipt)).outcome, "completed");
  await eventually(() => stream.state.doc?.session.status === "idle" && stream.state.committed.length >= 2);
  // Deltas: the live text crossed the wire about once, not once per frame.
  assert(stream.state.bytes < 400 * 1024, `${stream.state.bytes} bytes for a 128 KB answer`);
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
    (await fetch(`${f.base}/api/sessions/${id}/live`)).status,
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
    // A start may wait for its turn, so only other commands fill the pending reserve: 16 chats, each with a pending steer.
    const f = await fixture(t, {}, boundary === "pending" ? { maxLiveSessions: 16, maxRunning: 16 } : {});
    let release!: () => void;
    if (boundary === "pending") {
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const key = `pispark-http-input:${f.root}`;
      const globals = globalThis as unknown as Record<string, unknown>;
      globals[key] = () => gate;
      const dir = join(f.home, "personas", "default", "extensions");
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "pending-input.mjs"),
        `export default pi => pi.on('input', async event => { if(event.text === 'pending') await globalThis[${JSON.stringify(key)}](); return {action:'continue'}; });`,
      );
      t.after(() => {
        release();
        delete globals[key];
      });
    }
    const ids: string[] = [];
    for (let i = 0; i < (boundary === "pending" ? 16 : 1); i++)
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
        type: boundary === "pending" ? "steer" : "start",
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
