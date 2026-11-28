import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request, type ServerResponse } from "node:http";
import { test, type TestContext } from "node:test";
import { eventStream, type EventStream, type StreamTiming } from "../src/http/event-stream.js";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A server whose one route opens an event stream with these timings, and a reader of it. */
async function stream(t: TestContext, timing: StreamTiming, use: (stream: EventStream) => void = () => {}) {
  let opened!: EventStream;
  const server = createServer((_request, response: ServerResponse) => {
    opened = eventStream(response, timing);
    use(opened);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as { port: number };
  const received: string[] = [];
  const reader = request({ host: "127.0.0.1", port, path: "/" });
  reader.end();
  const [response] = (await once(reader, "response")) as [import("node:http").IncomingMessage];
  response.setEncoding("utf8");
  response.on("data", (chunk: string) => received.push(chunk));
  const ended = once(response, "end").then(() => true, () => true);
  return { received: () => received.join(""), headers: response.headers, ended, stream: () => opened, response };
}

test("an event stream says it is there while quiet, and only while quiet", async (t) => {
  // Generous against a loaded machine: frames 20 ms apart never leave a 400 ms gap.
  const s = await stream(t, { pingMs: 400, drainMs: 1000, lifetimeMs: 10_000 });
  assert.equal(s.headers["content-type"], "text/event-stream");
  assert.equal(s.headers["cache-control"], "no-store, no-transform");
  await pause(1000);
  assert.match(s.received(), /^: ping\n\n/);
  // Frames sent more often than the ping interval leave no room for one.
  const before = s.received().length;
  for (let i = 0; i < 12; i++) {
    await s.stream().send("changed", { i });
    await pause(20);
  }
  assert.doesNotMatch(s.received().slice(before), /ping/);
  assert.match(s.received(), /event: changed\ndata: \{"i":11\}\n\n/);
  s.stream().close();
  assert(await s.ended);
});

test("an event stream ends after its lifetime, and a frame past its limit is refused unsent", async (t) => {
  const s = await stream(t, { pingMs: 10_000, drainMs: 1000, lifetimeMs: 120 });
  await assert.rejects(s.stream().send("ops", { text: "x".repeat(100) }, 50), { code: "limit" });
  assert(await s.ended);
  assert.equal(s.received(), "");
  assert.equal(s.stream().open, false);
});

test("a reader that stops reading is dropped, not buffered for", async (t) => {
  const s = await stream(t, { pingMs: 10_000, drainMs: 100, lifetimeMs: 10_000 });
  s.response.pause();
  const big = "x".repeat(256 * 1024);
  const started = Date.now();
  // Keep writing until the socket is full; the write that has to wait gives up after drainMs.
  while (s.stream().open && Date.now() - started < 5000) await s.stream().send("ops", { big });
  assert.equal(s.stream().open, false);
  assert(Date.now() - started < 5000, "dropped within the drain wait");
});
