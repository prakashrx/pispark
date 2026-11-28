import { afterEach, expect, test, vi } from "vitest";
import { liveEvents, retryDelay, workspaceEvents } from "./live-stream";

/** A server whose answer is these chunks; `open` keeps the stream open after them, as a live one stays. */
function serve(chunks: string[], { open = false } = {}) {
  const sent = { more: (_chunk: string) => {} };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          if (!open) controller.close();
          sent.more = (chunk) => controller.enqueue(new TextEncoder().encode(chunk));
          init.signal?.addEventListener("abort", () => controller.error(init.signal!.reason));
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }),
  );
  return sent;
}
const never = new AbortController().signal;
async function read<T>(events: AsyncGenerator<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of events) values.push(value);
  return values;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("live-stream: pulls split and combined frames of both kinds without retaining a replay buffer", async () => {
  serve(["event: snap", 'shot\ndata: {"type":"snapshot","head":null}\n', '\nevent: ops\ndata: {"type":"ops","seq":1}\n\n']);
  expect((await read(liveEvents("s", never))).map((value) => value.type)).toEqual(["snapshot", "ops"]);
});

test("live-stream: the server's pings are skipped, whole or split across chunks", async () => {
  serve([": ping\n\n", 'event: ops\ndata: {"type":"ops","seq":1}\n\n: pi', "ng\n\n", 'event: ops\ndata: {"type":"ops","seq":2}\n\n']);
  expect((await read(liveEvents("s", never))).map((value) => value.type === "ops" && value.seq)).toEqual([1, 2]);
});

test("live-stream: bounded incomplete frames and invalid framing fail closed", async () => {
  for (const chunks of [
    ["x".repeat(1024 * 1024), "x"],
    ["data: {}\n\n"],
    ["event: other\ndata: {}\n\n"],
    ["event: ops\ndata: not-json\n\n"],
  ]) {
    serve(chunks);
    await expect(read(liveEvents("s", never))).rejects.toThrow();
  }
});

test("live-stream: a stream that says nothing for the silence limit is given up, and one that pings is not", async () => {
  vi.useFakeTimers();
  const server = serve(['event: snapshot\ndata: {"type":"snapshot","head":null}\n\n'], { open: true });
  const values: string[] = [];
  const reading = (async () => {
    for await (const value of liveEvents("s", never, 1000)) values.push(value.type);
  })();
  const failed = expect(reading).rejects.toThrow("Observation silent");
  // Pings every 600 ms keep it open well past the limit.
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(600);
    server.more(": ping\n\n");
  }
  server.more('event: ops\ndata: {"type":"ops","seq":1}\n\n');
  await vi.advanceTimersByTimeAsync(10);
  expect(values).toEqual(["snapshot", "ops"]);
  // Then nothing at all: given up once the limit passes.
  await vi.advanceTimersByTimeAsync(1001);
  await failed;
});

test("workspace stream: ready, then which areas changed; a session's frames are not accepted there", async () => {
  serve(['event: ready\ndata: {"type":"ready"}\n\n: ping\n\nevent: chan', 'ged\ndata: {"type":"changed","areas":["sessions","host"]}\n\n']);
  expect(await read(workspaceEvents(never))).toEqual([{ type: "ready" }, { type: "changed", areas: ["sessions", "host"] }]);
  serve(['event: ops\ndata: {"type":"ops"}\n\n']);
  await expect(read(workspaceEvents(never))).rejects.toThrow("Unexpected observation");
});

test("retry delay: 1–3 s at first, growing with each failure in a row, never past 15 s", () => {
  expect(retryDelay(1, () => 0)).toBe(1000);
  expect(retryDelay(1, () => 1)).toBe(3000);
  expect(retryDelay(2, () => 0)).toBe(2000);
  expect(retryDelay(3, () => 0.5)).toBe(8000);
  expect(retryDelay(10, () => 1)).toBe(15_000);
});
