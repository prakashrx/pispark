import type { ServerResponse } from "node:http";
import type { LiveEvent, WorkspaceArea, WorkspaceChange } from "../contract/protocol.js";
import { RuntimeError } from "../core/runtime/errors.js";
import type { SessionRuntime } from "../core/runtime/session-runtime.js";
import { STREAM_TIMING, eventStream, type StreamTiming } from "./event-stream.js";
import type { WorkspaceLive } from "./workspace-live.js";

/** A live frame is a snapshot or one tick's operations. */
const MAX_LIVE_FRAME = 1024 * 1024;
/** How long a batch waits so a burst of Pi events leaves as one frame. */
const FLUSH_MS = 50;
/** At most this many of each kind of stream at once. */
const MAX_STREAMS = 16;

/**
 * The server-sent event streams: one session's live document, and which areas of the workspace changed.
 * Each knows the paired device it is for (none: this computer), so a removed device's streams end.
 * Both are written through `eventStream`: a ping while quiet, a slow reader dropped, a lifetime cap.
 */
export class LiveStreams {
  /** Open streams, and the paired device each one is for. */
  private readonly streams = new Map<ServerResponse, string | undefined>();
  private workspaceStreams = 0;
  private sessionStreams = 0;

  constructor(
    private readonly runtime: SessionRuntime,
    private readonly workspace: WorkspaceLive,
    private readonly timing: StreamTiming = STREAM_TIMING,
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
   * A session's live document: a snapshot, then batches of what changed. When it ends (its lifetime, or
   * the session stopping), the client reconnects, gets a fresh snapshot and fetches only the history it is missing.
   */
  async session(id: string, response: ServerResponse, device?: string) {
    if (this.sessionStreams >= MAX_STREAMS) throw new RuntimeError("limit");
    let observation;
    try {
      observation = this.runtime.observeLive(id);
    } catch (error) {
      if (!(error instanceof RuntimeError) || error.code !== "not-found") throw error;
      // Not an error: sessions unload when idle. The client opens it again and reconnects.
      const stream = eventStream(response, this.timing);
      await stream.send("unloaded", { type: "unloaded", sessionId: id } satisfies LiveEvent);
      return stream.close();
    }
    this.sessionStreams++;
    this.streams.set(response, device);
    const stream = eventStream(response, this.timing);
    // The observation's events end when the stream does, so the loop below never waits on a closed one.
    void stream.ended.then(() => observation.events.close());
    const send = (event: LiveEvent) => stream.send(event.type, event, MAX_LIVE_FRAME);
    try {
      await send(observation.view.snapshot());
      for await (const _ of observation.events) {
        if (!stream.open) break;
        // Pi emits many small events; wait briefly so a burst leaves as one batch.
        await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));
        let batch;
        try {
          batch = observation.view.next();
        } catch {
          break;
        } // stop/unload settlement remains in its receipt; reconnect must open explicitly.
        if (batch) await send(batch);
      }
    } finally {
      stream.close();
      observation.events.close();
      this.sessionStreams--;
      this.streams.delete(response);
    }
  }

  /** The workspace stream: `ready` once listening (the client reads everything then), then which areas changed. */
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
    const stream = eventStream(response, this.timing);
    try {
      await stream.send("ready", { type: "ready" });
      while (stream.open) {
        if (!pending.length) {
          await Promise.race([stream.ended, new Promise<void>((resolve) => (wake = resolve))]);
          wake = undefined;
          continue;
        }
        const areas = pending;
        pending = [];
        await stream.send("changed", { type: "changed", areas } satisfies WorkspaceChange);
      }
    } finally {
      stop();
      stream.close();
      this.streams.delete(response);
      this.workspaceStreams--;
    }
  }
}
