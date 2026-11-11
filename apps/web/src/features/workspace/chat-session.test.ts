import { afterEach, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/svelte";
import type { LiveEvent, SessionDoc } from "../../../../server/src/contract/protocol";
import { ChatSession } from "./chat-session.svelte";
import { Transport } from "./transport";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const session = { id: "s", status: "idle" } as unknown as SessionDoc;
const snapshot: LiveEvent = { type: "snapshot", sessionId: "s", head: null, doc: { session, tail: [], progress: {} } };
const stream = (body: string) => new Response(body, { headers: { "Content-Type": "text/event-stream" } });

test("a live stream the server ends on purpose is followed on at once, and the chat stays Live", async () => {
  const states: string[] = [];
  let streams = 0;
  let hold!: () => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/sessions/s/items")) return new Response(JSON.stringify({ items: [], head: null, more: false }));
      if (url === "/api/sessions/s/live") {
        streams++;
        // The first stream sends the chat and ends, as the server does after its lifetime; the next stays open.
        if (streams === 1) return stream(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
        return new Promise<Response>((resolve) => (hold = () => resolve(stream(""))));
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
  const transport = new Transport();
  const chat = new ChatSession("s", transport, {
    changed: () => states.push(chat.connection),
    refresh: async () => {},
    roomForDraft: () => true,
    notice: () => {},
  });
  const timers = vi.spyOn(globalThis, "setTimeout");
  try {
    await chat.show();
    await waitFor(() => expect(streams).toBe(2));
    expect(chat.connection).toBe("Live");
    expect(states).toEqual(["Live"]);
    // No pause before following on: the reconnect delay is only for a stream that failed.
    expect(timers.mock.calls.some(([, delay]) => delay === 2000)).toBe(false);
  } finally {
    hold?.();
    chat.hide();
    transport.close();
  }
});
