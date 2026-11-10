import assert from "node:assert/strict";
import type { Item, LiveDoc, LiveEvent } from "../../src/protocol.js";
import { applyOp } from "../../src/stream-ops.js";
import type { Json } from "../../src/stream-ops.js";

/** A minimal browser stand-in: reads `/live`, applies operations in order and keeps what it learned. */
export async function observeLive(base: string, id: string) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/sessions/${id}/live`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const state = {
    events: [] as LiveEvent[],
    doc: undefined as LiveDoc | undefined,
    head: undefined as string | null | undefined,
    /** Items delivered by commits, in order. */
    committed: [] as Item[],
    commits: 0,
    bytes: 0,
  };
  const reader = response.body!.getReader();
  let pending = "";
  const decoder = new TextDecoder();
  const reading = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          state.bytes += Buffer.byteLength(frame);
          const event = JSON.parse(frame.split("data: ")[1]!) as LiveEvent;
          const previous = state.events.at(-1);
          if (event.type === "snapshot") {
            state.doc = event.doc;
            state.head = event.head;
          } else if (event.type === "ops") {
            assert(previous, "operations before a snapshot");
            assert.equal(event.seq, previous.type === "snapshot" ? 1 : (previous as { seq: number }).seq + 1);
            for (const op of event.ops) {
              if (op.op === "commit") {
                assert.equal(op.after, state.head);
                state.head = op.head;
                state.commits++;
                state.committed.push(...(op.items ?? []));
              } else applyOp(state.doc as unknown as { [key: string]: Json }, op);
            }
          }
          state.events.push(event);
        }
      }
    } catch {
      /* explicit disconnect */
    }
  })();
  return {
    state,
    get events() {
      return state.events;
    },
    close: async () => {
      controller.abort();
      await reading;
    },
  };
}
