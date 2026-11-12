import { afterEach, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/svelte";
import type { LiveEvent, SessionDoc } from "../../../../server/src/contract/protocol";
import { Session } from "./session.svelte";
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
  const session = new Session("s", transport, {
    changed: () => states.push(session.connection),
    refresh: async () => {},
    roomForDraft: () => true,
    notice: () => {},
  });
  const timers = vi.spyOn(globalThis, "setTimeout");
  try {
    await session.show();
    await waitFor(() => expect(streams).toBe(2));
    expect(session.connection).toBe("Live");
    expect(states).toEqual(["Live"]);
    // No pause before following on: the reconnect delay is only for a stream that failed.
    expect(timers.mock.calls.some(([, delay]) => delay === 2000)).toBe(false);
  } finally {
    hold?.();
    session.hide();
    transport.close();
  }
});

/**
 * A chat on screen whose live stream the test feeds: each `offer` is the session's views now.
 * `home` makes it the session of an app persona with that home view.
 */
function followed(id: string, home?: string) {
  let feed!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith(`/api/sessions/${id}/items`)) return new Response(JSON.stringify({ items: [], head: null, more: false }));
      if (url === `/api/sessions/${id}/live`)
        return new Response(new ReadableStream<Uint8Array>({ start: (controller) => void (feed = controller) }), {
          headers: { "Content-Type": "text/event-stream" },
        });
      throw new Error(`unexpected ${url}`);
    }),
  );
  const transport = new Transport();
  const session = new Session(id, transport, { changed: () => {}, refresh: async () => {}, roomForDraft: () => true, notice: () => {} });
  let sent = 0;
  return {
    session,
    /** The server says which views are offered, as `key` or `key:attention`. */
    async offer(...views: string[]) {
      const title = String(++sent);
      const doc = {
        session: {
          id,
          status: "idle",
          title,
          ...(home ? { persona: { id: "app", name: "App", layered: false, home } } : {}),
          extensions: {
            views: views.map((view) => {
              const [key, attention] = view.split(":");
              return { point: "session.view", key, title: key, url: `/${key}.js`, ...(attention ? { attention: Number(attention) } : {}) };
            }),
          },
        },
        tail: [],
        progress: {},
      };
      await waitFor(() => expect(feed).toBeDefined());
      feed.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify({ type: "snapshot", sessionId: id, head: null, doc })}\n\n`));
      // Applied once the session shows this snapshot's marker.
      await waitFor(() => expect(session.doc?.title).toBe(title));
    },
    close() {
      session.hide();
      transport.close();
    },
  };
}

test("a session opens on the conversation; the view a person chose is remembered, and shows once it is offered", async () => {
  localStorage.clear();
  const first = followed("views-1");
  try {
    await first.session.show();
    await first.offer();
    expect(first.session.shownView).toBeUndefined();
    // Offered views do not take the session over: the conversation stays until the person chooses.
    await first.offer("desk", "log");
    expect(first.session.views.map((view) => view.key)).toEqual(["desk", "log"]);
    expect(first.session.shownView).toBeUndefined();
    first.session.showView("log");
    expect(first.session.shownView).toBe("log");
    expect(localStorage.getItem("pispark:view:views-1")).toBe("log");
    // The view goes away (its extension removed it): the conversation shows; back, it shows again.
    await first.offer("desk");
    expect(first.session.shownView).toBeUndefined();
    await first.offer("desk", "log");
    expect(first.session.shownView).toBe("log");
  } finally {
    first.close();
  }

  // Opened again later (a new page): the choice is read back, and waits for the view to be offered.
  const again = followed("views-1");
  try {
    await again.session.show();
    await again.offer("desk");
    expect(again.session.shownView).toBeUndefined();
    await again.offer("desk", "log");
    expect(again.session.shownView).toBe("log");
    // Choosing the conversation is a choice too, and is kept.
    again.session.showView();
    expect(again.session.shownView).toBeUndefined();
    expect(localStorage.getItem("pispark:view:views-1")).toBe("");
  } finally {
    again.close();
  }

  // A person who switched before the remembered view was offered keeps what they chose.
  localStorage.setItem("pispark:view:views-2", "log");
  const switched = followed("views-2");
  try {
    await switched.session.show();
    await switched.offer("desk");
    switched.session.showView("desk");
    await switched.offer("desk", "log");
    expect(switched.session.shownView).toBe("desk");
  } finally {
    switched.close();
  }
});

test("a view that asks to be shown is shown once, while the session is on screen; what it asked before is not replayed", async () => {
  localStorage.clear();
  const { session, offer, close } = followed("views-3");
  try {
    await session.show();
    // What the session finds when it opens is not acted on.
    await offer("desk:2", "log");
    expect(session.shownView).toBeUndefined();
    // A new request, seen while the session is on screen, shows the view and is remembered.
    await offer("desk:3", "log");
    expect(session.shownView).toBe("desk");
    expect(localStorage.getItem("pispark:view:views-3")).toBe("desk");
    // The person switches back; the same count never switches again.
    session.showView();
    await offer("desk:3", "log");
    expect(session.shownView).toBeUndefined();
    // A view first offered with a request, after the session opened, is a new request.
    await offer("desk:3", "log", "board:1");
    expect(session.shownView).toBe("board");

    // Off screen and back: requests made meanwhile are found, not seen, so nothing switches.
    session.showView();
    session.hide();
    await session.show();
    await offer("desk:9", "log", "board:1");
    expect(session.shownView).toBeUndefined();
    await offer("desk:10", "log", "board:1");
    expect(session.shownView).toBe("desk");
  } finally {
    close();
  }
});

test("an app's session opens on its home view until the person chooses another, the conversation included", async () => {
  localStorage.clear();
  const first = followed("app-1", "desk");
  try {
    await first.session.show();
    // Nothing offers the home view yet: the conversation shows, and nothing is made up.
    await first.offer("log");
    expect(first.session.shownView).toBeUndefined();
    await first.offer("log", "desk");
    expect(first.session.shownView).toBe("desk");
    first.session.showView();
    expect(first.session.shownView).toBeUndefined();
  } finally {
    first.close();
  }
  // Opened again: the person chose the conversation, so the home view does not come back by itself.
  const again = followed("app-1", "desk");
  try {
    await again.session.show();
    await again.offer("log", "desk");
    expect(again.session.shownView).toBeUndefined();
    again.session.showView("log");
    expect(again.session.shownView).toBe("log");
  } finally {
    again.close();
  }
});
