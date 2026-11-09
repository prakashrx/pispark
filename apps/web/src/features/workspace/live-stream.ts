import type { LiveEvent } from "../../../../server/src/protocol";

const FRAME_LIMIT = 1024 * 1024;
const HEADS = ["event: snapshot\ndata: ", "event: ops\ndata: "];

/** Pull-based SSE reader: one bounded incomplete frame, no accumulating browser event queue. */
export async function* liveEvents(
  response: Response,
): AsyncGenerator<LiveEvent> {
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
        const head = HEADS.find((prefix) => frame.startsWith(prefix));
        if (!head) throw new Error("Unexpected observation");
        yield JSON.parse(frame.slice(head.length)) as LiveEvent;
      }
      if (pending.length > FRAME_LIMIT)
        throw new Error("Observation frame limit");
    }
  } finally {
    await reader.cancel();
  }
}
