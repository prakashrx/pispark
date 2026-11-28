import type { ServerResponse } from "node:http";
import { once } from "node:events";
import { RuntimeError } from "../core/runtime/errors.js";

/** How a live stream keeps itself honest; tests make these short. */
export interface StreamTiming {
  /** A comment line after this long without a frame, so a quiet stream is seen to be alive (and proxies keep it open). */
  pingMs: number;
  /** How long a reader that stops reading is waited for before it is dropped. */
  drainMs: number;
  /**
   * The longest a stream stays open. The server cannot see a reader that vanished without closing (a phone
   * that slept behind a proxy) until a write fails, so a stream ends after this and the client follows on.
   */
  lifetimeMs: number;
}
export const STREAM_TIMING: StreamTiming = { pingMs: 15_000, drainMs: 2000, lifetimeMs: 10 * 60_000 };

/** A server-sent event stream: the headers, frames written in order, a ping while quiet, an end. */
export interface EventStream {
  /**
   * Writes one event; resolves once the reader has room again. A reader that stops reading is dropped.
   * A frame larger than `maximum` bytes is refused (`limit`) and nothing is written.
   */
  send(event: string, data: unknown, maximum?: number): Promise<void>;
  /** Resolves when the stream has ended, by either side. */
  readonly ended: Promise<void>;
  /** Whether it has ended. */
  readonly open: boolean;
  /** Ends it and lets go of its timers. Safe to call more than once. */
  close(): void;
}

/**
 * Opens a server-sent event stream on `response`. Nothing is buffered for a slow reader: a write that
 * doesn't fit waits `drainMs`, then the stream is dropped. A ping (`: ping`, which a reader skips) is
 * written only when no frame has gone for `pingMs`.
 */
export function eventStream(response: ServerResponse, timing: StreamTiming = STREAM_TIMING): EventStream {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" });
  let open = true;
  let quietSince = Date.now();
  const ended = new Promise<void>((resolve) => response.once("close", resolve)).then(() => void (open = false));
  const write = async (text: string) => {
    quietSince = Date.now();
    if (response.write(text)) return;
    const drained = await Promise.race([once(response, "drain").then(() => true), ended.then(() => false), delay(timing.drainMs)]);
    if (!drained) response.destroy();
  };
  const ping = setInterval(() => {
    // A write still waiting for room is proof enough; never stack a ping behind it.
    if (open && !response.writableNeedDrain && Date.now() - quietSince >= timing.pingMs) void write(": ping\n\n");
  }, Math.max(10, timing.pingMs / 3));
  const lifetime = setTimeout(() => close(), timing.lifetimeMs);
  const close = () => {
    open = false;
    clearInterval(ping);
    clearTimeout(lifetime);
    if (!response.writableEnded) response.end();
  };
  void ended.then(close);
  return {
    send: async (event, data, maximum = Infinity) => {
      const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      if (Buffer.byteLength(text) > maximum) throw new RuntimeError("limit");
      if (open) await write(text);
    },
    ended,
    get open() {
      return open && !response.destroyed && !response.writableEnded;
    },
    close,
  };
}

const delay = (ms: number) => new Promise<false>((resolve) => setTimeout(() => resolve(false), ms).unref());
