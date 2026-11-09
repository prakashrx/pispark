import { expect, test, vi } from "vitest";
import type { Item, ItemsPage, LiveEvent, SessionDoc } from "../../../../server/src/protocol";
import { LiveChat } from "./live-chat.svelte";

const session = { id: "s", status: "running" } as unknown as SessionDoc;
const item = (id: string, text: string, role: Item["role"] = "assistant"): Item => ({
  id,
  key: id,
  role,
  parts: [{ type: "text", text }],
});
const page = (items: Item[], head: string | null, more = false): ItemsPage => ({ items, head, more });
const snapshot = (head: string | null, tail: Item[] = []): LiveEvent => ({ type: "snapshot", sessionId: "s", head, doc: { session, tail } });
const ops = (seq: number, ...list: Extract<LiveEvent, { type: "ops" }>["ops"]): LiveEvent => ({ type: "ops", sessionId: "s", seq, ops: list });

function chat(pages: Record<string, ItemsPage>) {
  const get = vi.fn(async (path: string) => {
    const hit = pages[path.replace("/api/sessions/s/items", "")];
    if (!hit) throw new Error("unexpected " + path);
    return hit as never;
  });
  return { live: new LiveChat(get), get };
}

test("history loads by cursor; the snapshot only adds what the client lacks", async () => {
  const { live, get } = chat({
    "?limit=40": page([item("a", "one"), item("b", "two")], "b", true),
    "?after=b&limit=100": page([item("c", "three")], "c"),
    "?before=a&limit=40": page([item("z", "zero")], "z"),
  });
  await live.load("s");
  expect(live.more).toBe(true);
  await live.apply("s", snapshot("b"));
  expect(get).toHaveBeenCalledTimes(1);
  // A reconnect after the chat moved on fetches the gap, not the whole chat.
  await live.apply("s", snapshot("c"));
  expect(live.history.map((i) => i.id)).toEqual(["a", "b", "c"]);
  await live.loadEarlier("s");
  expect(live.history.map((i) => i.id)).toEqual(["z", "a", "b", "c"]);
});

test("operations grow the tail in place and a commit moves finished items into history", async () => {
  const { live } = chat({ "?limit=40": page([item("a", "hi", "user")], "a") });
  await live.load("s");
  await live.apply("s", snapshot("a", [{ ...item("", "wor"), id: undefined, key: "t1" }]));
  expect(live.items.map((i) => (i.parts[0] as { text: string }).text)).toEqual(["hi", "wor"]);
  expect(await live.apply("s", ops(1, { op: "append", path: ["tail", 0, "parts", 0, "text"], text: "ld" }))).toBe(true);
  expect((live.items.at(-1)!.parts[0] as { text: string }).text).toBe("world");
  const done = { ...item("b", "world"), key: "t1" };
  expect(
    await live.apply("s", ops(2, { op: "commit", after: "a", head: "b", items: [done] }, { op: "set", path: ["tail"], value: [] })),
  ).toBe(true);
  expect(live.history.map((i) => i.id)).toEqual(["a", "b"]);
  expect(live.doc!.tail).toEqual([]);
  // The item keeps its key through the commit; nothing is drawn twice even before the tail shrinks.
  expect(live.items.map((i) => i.key)).toEqual(["a", "t1"]);
});

test("a gap in order or in history asks for the stream to be opened again", async () => {
  const { live } = chat({ "?limit=40": page([item("a", "hi")], "a") });
  await live.load("s");
  await live.apply("s", snapshot("a"));
  expect(await live.apply("s", ops(2, { op: "set", path: ["session", "status"], value: "idle" }))).toBe(false);
  await live.apply("s", snapshot("a"));
  expect(await live.apply("s", ops(1, { op: "commit", after: "elsewhere", head: "x", items: [] }))).toBe(false);
});

test("a commit announced without its items is read as history", async () => {
  const { live } = chat({
    "?limit=40": page([item("a", "hi")], "a"),
    "?after=a&limit=100": page([item("b", "big")], "b"),
  });
  await live.load("s");
  await live.apply("s", snapshot("a"));
  expect(await live.apply("s", ops(1, { op: "commit", after: "a", head: "b" }))).toBe(true);
  expect(live.history.map((i) => i.id)).toEqual(["a", "b"]);
});

