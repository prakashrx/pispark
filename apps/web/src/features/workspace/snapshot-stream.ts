import type { SnapshotEvent } from "../../../../server/src/protocol";

/** Pull-based SSE reader: one bounded incomplete frame, no accumulating browser event queue. */
export async function* snapshots(
  response: Response,
): AsyncGenerator<SnapshotEvent> {
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
      if (value.byteLength > 256 * 1024)
        throw new Error("Observation chunk limit");
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        if (end > 256 * 1024) throw new Error("Observation frame limit");
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (!frame.startsWith("event: snapshot\ndata: "))
          throw new Error("Unexpected observation");
        yield JSON.parse(
          frame.slice("event: snapshot\ndata: ".length),
        ) as SnapshotEvent;
      }
      if (pending.length > 256 * 1024)
        throw new Error("Observation frame limit");
    }
  } finally {
    await reader.cancel();
  }
}
