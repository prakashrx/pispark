import type { ServerResponse } from "node:http";
import { once } from "node:events";
import type { LiveEvent, WorkspaceArea, WorkspaceChange } from "../contract/protocol.js";
import { RuntimeError } from "../core/runtime/errors.js";
import type { SessionRuntime } from "../core/runtime/session-runtime.js";
import type { WorkspaceLive } from "./workspace-live.js";

/** A live frame is a snapshot or one tick's operations. */
const MAX_LIVE_FRAME = 1024 * 1024;
/** How long a batch waits so a burst of Pi events leaves as one frame. */
const FLUSH_MS = 50;
/** At most this many of each kind of stream at once. */
const MAX_STREAMS = 16;

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * The server-sent event streams: one session's live document, and which areas of the workspace changed.
 * Each knows the paired device it is for (none: this computer), so a removed device's streams end.
 */
export class LiveStreams {
  /** Open streams, and the paired device each one is for. */
  private readonly streams = new Map<ServerResponse, string | undefined>();
  private workspaceStreams = 0;

  constructor(
    private readonly runtime: SessionRuntime,
    private readonly workspace: WorkspaceLive,
  ) {}

  /** Ends the streams of one paired device, or (no device) of every remote device. */
  endRemote(device?: string) {
    for (const [stream, owner] of this.streams) if (owner && (device === undefined || owner === device)) stream.end();
  }

  /** Ends every stream, when the server stops. */
  endAll() {
    for (const stream of this.streams.keys()) stream.end();
  }

  /**
   * A session's live document: a snapshot, then batches of what changed. Ends after a minute; the client
   * reconnects, gets a fresh snapshot and fetches only the history it is missing.
   */
  async session(id: string, response: ServerResponse, device?: string) {
    // Session streams count every open stream, workspace ones included.
    if (this.streams.size >= MAX_STREAMS) throw new RuntimeError("limit");
    let observation;
    try {
      observation = this.runtime.observeLive(id);
    } catch (error) {
      if (!(error instanceof RuntimeError) || error.code !== "not-found") throw error;
      // Not an error: sessions unload when idle. The client opens it again and reconnects.
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      response.end(frame("unloaded", { type: "unloaded", sessionId: id } satisfies LiveEvent));
      return;
    }
    this.streams.set(response, device);
    const close = () => observation.events.close();
    response.once("close", close);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = async (event: LiveEvent) => {
      const text = frame(event.type, event);
      if (Buffer.byteLength(text) > MAX_LIVE_FRAME) throw new RuntimeError("limit");
      if (!response.write(text)) {
        // A reader that stops reading is dropped rather than buffered for.
        const controller = new AbortController();
        timer = setTimeout(() => {
          controller.abort();
          response.destroy();
        }, 2000);
        try {
          await once(response, "drain", { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      }
    };
    // The lifetime cap frees abandoned connections even if no further writes occur.
    const lifetime = setTimeout(() => response.end(), 60_000);
    try {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      await write(observation.view.snapshot());
      for await (const _ of observation.events) {
        if (response.destroyed || response.writableEnded) break;
        // Pi emits many small events; wait briefly so a burst leaves as one batch.
        await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));
        let batch;
        try {
          batch = observation.view.next();
        } catch {
          break;
        } // stop/unload settlement remains in its receipt; reconnect must open explicitly.
        if (batch) await write(batch);
      }
      response.end();
    } finally {
      clearTimeout(timer);
      clearTimeout(lifetime);
      close();
      this.streams.delete(response);
      response.off("close", close);
    }
  }

  /**
   * The workspace stream: `ready` once listening (the client reads everything then), then which areas
   * changed. Ends after five minutes; the client follows on at once and reads everything again.
   */
  async workspaceChanges(response: ServerResponse, device?: string) {
    if (this.workspaceStreams >= MAX_STREAMS) throw new RuntimeError("limit");
    this.workspaceStreams++;
    this.streams.set(response, device);
    let pending: WorkspaceArea[] = [];
    let wake: (() => void) | undefined;
    const stop = this.workspace.listen((areas) => {
      pending = [...new Set([...pending, ...areas])];
      wake?.();
    });
    let gone = false;
    const ended = new Promise<void>((resolve) => response.once("close", resolve)).then(() => void (gone = true));
    const lifetime = setTimeout(() => response.end(), 5 * 60_000);
    try {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
      response.write(frame("ready", { type: "ready" }));
      while (!gone && !response.destroyed && !response.writableEnded) {
        if (!pending.length) {
          await Promise.race([ended, new Promise<void>((resolve) => (wake = resolve))]);
          wake = undefined;
          continue;
        }
        const areas = pending;
        pending = [];
        // A reader that stops reading is dropped rather than buffered for.
        if (!response.write(frame("changed", { type: "changed", areas } satisfies WorkspaceChange))) {
          const drained = await Promise.race([once(response, "drain").then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 2000))]);
          if (!drained) response.destroy();
        }
      }
    } finally {
      stop();
      clearTimeout(lifetime);
      this.streams.delete(response);
      this.workspaceStreams--;
      if (!response.writableEnded) response.end();
    }
  }
}
