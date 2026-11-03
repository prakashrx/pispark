import { afterEach, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/svelte";
import { SessionClient } from "./session-client.svelte";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});
test("no-chat reconnect recovers catalog without duplicate timers/listeners or resending a prompt", async () => {
  let catalogs = 0;
  let release!: (value: Response) => void;
  const calls = vi.fn(async (url: string) => {
    if (url === "/api/catalog") {
      catalogs++;
      if (catalogs === 1)
        return new Response(JSON.stringify({ error: "configuration" }), {
          status: 503,
        });
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return new Response(
      JSON.stringify(
        url === "/api/providers"
          ? { providers: [], defaultModel: null, networkBlocked: false }
          : url === "/api/personas"
            ? { personas: [] }
            : { sessions: [], truncated: false },
      ),
    );
  });
  vi.stubGlobal("fetch", calls);
  const listeners = vi.spyOn(window, "addEventListener");
  const timers = vi.spyOn(globalThis, "setInterval");
  const client = new SessionClient();
  try {
    await client.mount();
    expect(client.connection).toBe("Disconnected");
    expect(client.catalogError).toBe(true);
    client.reconnect();
    client.reconnect();
    expect(catalogs).toBe(2);
    release(
      new Response(
        JSON.stringify({
          workspaces: [{ value: "local", label: "Actual folder" }],
          configurations: [{ value: "setup", label: "Actual setup" }],
        }),
      ),
    );
    await waitFor(() => expect(client.connection).toBe("Connected"));
    expect(client.catalogError).toBe(false);
    expect(client.error).toBe("");
    expect(
      timers.mock.calls.filter(([, delay]) => delay === 5000),
    ).toHaveLength(1);
    for (const type of ["beforeunload", "offline", "online"]) {
      const handlers = listeners.mock.calls
        .filter(([name]) => name === type)
        .map(([, handler]) => handler);
      expect(handlers).toHaveLength(2);
      expect(handlers[0]).toBe(handlers[1]); // Native addEventListener deduplicates the same listener.
    }
    expect(calls.mock.calls.some(([url]) => url === "/api/commands")).toBe(
      false,
    );
  } finally {
    client.dispose();
  }
});

test("successful truncated lists have a separate notice and later nontruncated refresh preserves unrelated errors", async () => {
  let truncated = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ sessions: [], truncated })),
    ),
  );
  const client = new SessionClient();
  client.error = "unrelated operation";
  await client.refresh();
  expect(client.listNotice).toBe(
    "Showing your latest 256 chats. Older chats are still saved.",
  );
  expect(client.error).toBe("unrelated operation");
  expect(client.drafts).toEqual({});
  truncated = false;
  await client.refresh();
  expect(client.listNotice).toBe("");
  expect(client.error).toBe("unrelated operation");
  client.dispose();
});

test("typed acceptance uncertainty retains reply draft and stays with originating chat, never replays", async () => {
  let commands = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      commands++;
      throw new Error("lost after acceptance");
    }),
  );
  const client = new SessionClient();
  client.selected = "origin";
  client.snapshot = { status: "idle" } as NonNullable<typeof client.snapshot>;
  client.setDraft("Keep unsent text");
  await client.reply();
  expect(client.drafts.origin).toBe("Keep unsent text");
  expect(client.sessionErrorKinds.origin).toBe("acceptance-unknown");
  expect(client.sessionErrors.origin).toContain("lost after acceptance");
  client.selected = "another";
  expect(client.sessionErrors.another).toBeUndefined();
  expect(commands).toBe(1);
  client.dispose();
});

test("accepted receipt polling loss is settlement uncertainty, not acceptance failure or replay", async () => {
  const calls = vi.fn(async (url: string) => {
    if (url === "/api/commands")
      return new Response(
        JSON.stringify({
          commandId: "accepted-command",
          sessionId: "origin",
          state: "accepted",
        }),
      );
    throw new Error("receipt connection lost");
  });
  vi.stubGlobal("fetch", calls);
  const client = new SessionClient();
  client.selected = "origin";
  await client.cancel();
  expect(client.sessionErrorKinds.origin).toBe("settlement-unknown");
  expect(client.sessionErrors.origin).toBe(
    "receipt connection lost (chat origin)",
  );
  expect(
    calls.mock.calls.filter(([url]) => url === "/api/commands"),
  ).toHaveLength(1);
  client.dispose();
});

test("unknown initial create acceptance and settlement are explicit without an identified chat", async () => {
  for (const accepted of [false, true]) {
    let commands = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/commands") {
          commands++;
          if (accepted)
            return new Response(
              JSON.stringify({
                commandId: "create-command",
                state: "accepted",
              }),
            );
        }
        throw new Error("lost create response");
      }),
    );
    const client = new SessionClient();
    expect(await client.ask("initial draft", "folder", "setup")).toBe(false);
    expect(client.errorKind).toBe(
      accepted ? "settlement-unknown" : "acceptance-unknown",
    );
    expect(client.error).toContain("lost create response");
    expect(commands).toBe(1);
    client.dispose();
  }
});
