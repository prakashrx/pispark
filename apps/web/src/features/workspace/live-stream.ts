import type { LiveEvent, WorkspaceChange } from "../../../../server/src/contract/protocol";

const FRAME_LIMIT = 1024 * 1024;
const HEADS = ["event: snapshot\ndata: ", "event: ops\ndata: ", "event: unloaded\ndata: "];
const WORKSPACE_HEADS = ["event: ready\ndata: ", "event: changed\ndata: "];

/** A session's live stream: its snapshot, then its changes. */
export function liveEvents(response: Response): AsyncGenerator<LiveEvent> {
  return frames<LiveEvent>(response, HEADS);
}
/** The workspace stream (`/api/live`): `ready`, then which areas changed. */
export function workspaceEvents(response: Response): AsyncGenerator<{ type: "ready" } | WorkspaceChange> {
  return frames(response, WORKSPACE_HEADS);
}

/** Pull-based SSE reader: one bounded incomplete frame, no accumulating browser event queue. */
async function* frames<T>(
  response: Response,
  heads: string[],
): AsyncGenerator<T> {
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("text/event-stream") ||
    !response.body
  )
    throw new Error("Observation unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > FRAME_LIMIT)
        throw new Error("Observation chunk limit");
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        if (end > FRAME_LIMIT) throw new Error("Observation frame limit");
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const head = heads.find((prefix) => frame.startsWith(prefix));
        if (!head) throw new Error("Unexpected observation");
        yield JSON.parse(frame.slice(head.length)) as T;
      }
      if (pending.length > FRAME_LIMIT)
        throw new Error("Observation frame limit");
    }
  } finally {
    await reader.cancel();
  }
}
