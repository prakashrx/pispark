import type { LiveEvent, WorkspaceChange } from "../../../../server/src/contract/protocol";

const FRAME_LIMIT = 1024 * 1024;
const HEADS = ["event: snapshot\ndata: ", "event: ops\ndata: ", "event: unloaded\ndata: "];
const WORKSPACE_HEADS = ["event: ready\ndata: ", "event: changed\ndata: "];
/**
 * The server pings a stream that has been quiet for 15 s. One that says nothing at all for this long is
 * gone (a sleeping laptop, a dropped Wi-Fi, a server that stopped without closing): it is given up and
 * opened again, rather than shown as Live while nothing can arrive.
 */
export const SILENCE_MS = 35_000;

/** A session's live stream: its snapshot, then its changes. */
export function liveEvents(id: string, signal: AbortSignal, silenceMs = SILENCE_MS): AsyncGenerator<LiveEvent> {
  return frames<LiveEvent>(`/api/sessions/${id}/live`, HEADS, signal, silenceMs);
}
/** The workspace stream (`/api/live`): `ready`, then which areas changed. */
export function workspaceEvents(signal: AbortSignal, silenceMs = SILENCE_MS): AsyncGenerator<{ type: "ready" } | WorkspaceChange> {
  return frames(`/api/live`, WORKSPACE_HEADS, signal, silenceMs);
}

/**
 * How long to wait before opening a stream again after `failures` failed tries in a row: 1–3 s at first,
 * growing to at most 15 s, and never the same for every page, so a restarted server isn't met by every
 * open tab and phone at once.
 */
export function retryDelay(failures: number, random = Math.random): number {
  return Math.min(15_000, (1000 + random() * 2000) * 2 ** Math.min(Math.max(failures - 1, 0), 3));
}

/**
 * Pull-based SSE reader: one bounded incomplete frame, no accumulating browser event queue. Comment
 * lines (the server's pings) are skipped; anything else it doesn't know fails the stream. Connecting and
 * reading are both watched: `silenceMs` without a byte ends it with an error.
 */
async function* frames<T>(url: string, heads: string[], signal: AbortSignal, silenceMs: number): AsyncGenerator<T> {
  const silent = new AbortController();
  let watchdog = setTimeout(() => silent.abort(new Error("Observation silent")), silenceMs);
  const heard = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => silent.abort(new Error("Observation silent")), silenceMs);
  };
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal, silent.signal]) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body)
      throw new Error("Observation unavailable");
    heard();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        heard();
        if (value.byteLength > FRAME_LIMIT) throw new Error("Observation chunk limit");
        pending += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          if (end > FRAME_LIMIT) throw new Error("Observation frame limit");
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          if (frame.startsWith(":")) continue;
          const head = heads.find((prefix) => frame.startsWith(prefix));
          if (!head) throw new Error("Unexpected observation");
          yield JSON.parse(frame.slice(head.length)) as T;
        }
        if (pending.length > FRAME_LIMIT) throw new Error("Observation frame limit");
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } finally {
    clearTimeout(watchdog);
  }
}
