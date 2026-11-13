import { expect, test } from "vitest";
import type { Item, ItemPart } from "../../../../server/src/contract/protocol";
import { buildTurns, clippedPart, itemText } from "./chat-turns";
import { artifactsOf, describeCall, summarizeCalls } from "./tool-views";
import { pointOf } from "./extension-views";

let n = 0;
const item = (role: Item["role"], parts: ItemPart[], extra: Partial<Item> = {}): Item => ({
  id: `e${++n}`,
  key: `k${n}`,
  role,
  parts,
  pos: n,
  ...extra,
});
const text = (value: string, size?: number): ItemPart => ({ type: "text", text: value, ...(size ? { size } : {}) });
const call = (id: string, name: string, args: Record<string, string> = {}): ItemPart => ({ type: "toolCall", id, name, args });
const result = (callId: string, value = "ok", extra: Partial<Item> = {}) =>
  item("toolResult", [text(value)], { callId, toolName: "x", ...extra });

test("a turn is your message and its response as ordered segments, tool results attached to their calls", () => {
  n = 0;
  const turns = buildTurns(
    [
      item("user", [text("tidy it")]),
      item("assistant", [{ type: "thinking", text: "plan" }, text("On it."), call("c1", "read", { path: "a.ts" })]),
      result("c1"),
      item("assistant", [call("c2", "edit", { path: "a.ts" })]),
      result("c2", "edited"),
      item("assistant", [text("Done.")]),
    ],
    { running: false },
  );
  expect(turns).toHaveLength(1);
  expect(turns[0]!.user?.parts[0]).toEqual(text("tidy it"));
  expect(turns[0]!.segments.map((s) => s.kind)).toEqual(["thinking", "text", "activity", "text"]);
  const activity = turns[0]!.segments[2]!;
  // Calls from separate assistant messages with nothing said between them are one activity.
  expect(activity.kind === "activity" && activity.calls.map((c) => [c.name, c.status])).toEqual([["read", "done"], ["edit", "done"]]);
  expect(activity.kind === "activity" && activity.calls[1]!.result?.parts[0]).toEqual(text("edited"));
});

test("text between calls splits activities; a call with no result is running only while the agent is", () => {
  n = 0;
  const items = [
    item("user", [text("go")]),
    item("assistant", [call("c1", "bash"), text("then"), call("c2", "bash")]),
    result("c1"),
  ];
  const running = buildTurns(items, { running: true })[0]!;
  expect(running.segments.map((s) => s.kind)).toEqual(["activity", "text", "activity"]);
  const first = running.segments[0];
  const second = running.segments[2];
  expect(first?.kind === "activity" && first.calls[0]!.status).toBe("done");
  expect(second?.kind === "activity" && [second.calls[0]!.status, second.live]).toEqual(["running", true]);
  const stopped = buildTurns(items, { running: false })[0]!;
  const tail = stopped.segments[2]!;
  expect(tail.kind === "activity" && [tail.calls[0]!.status, tail.live]).toEqual(["unfinished", false]);
});

test("the item being written streams; finished items do not", () => {
  n = 0;
  const items = [item("user", [text("hi")]), item("assistant", [text("first")]), item("assistant", [text("sec")])];
  const live = buildTurns(items, { running: true })[0]!;
  expect(live.segments.map((s) => s.kind === "text" && s.streaming)).toEqual([false, true]);
  expect(buildTurns(items, { running: false })[0]!.segments.every((s) => s.kind !== "text" || !s.streaming)).toBe(true);
});

test("history that begins mid-answer still shows; blank text and thinking are skipped; stops are said", () => {
  n = 0;
  const turns = buildTurns(
    [item("assistant", [text("  "), { type: "thinking", text: "" }, text("kept")], { stopReason: "aborted" }), item("user", [text("next")])],
    { running: false },
  );
  expect(turns).toHaveLength(2);
  expect(turns[0]!.user).toBeUndefined();
  expect(turns[0]!.segments.map((s) => s.kind)).toEqual(["text", "stopped"]);
  expect(turns[1]!.segments).toEqual([]);
});

test("extension notices land where they happened; one ahead of your message ends the answer before it", () => {
  n = 0;
  const notice = (id: number, after: number) => ({ id, kind: "info" as const, lines: [], after, at: id });
  // Item positions are 1 (you), 2 (answer), 3 (you), 4 (answer).
  const turns = buildTurns(
    [item("user", [text("a")]), item("assistant", [text("b")]), item("user", [text("c")]), item("assistant", [text("d")])],
    { running: false, notices: [notice(1, 2), notice(2, 3), notice(3, 99)] },
  );
  expect(turns.map((t) => t.segments.map((s) => s.kind))).toEqual([
    ["notice", "text", "notice"], // before the answer at 2; and ahead of your message at 3, ending this answer
    ["text", "notice"], // the leftover goes at the end
  ]);
});

test("custom entries, summaries and clipped parts keep their identity", () => {
  n = 0;
  const clipped = item("assistant", [text("start", 500)]);
  const turns = buildTurns([item("user", [text("q")]), clipped, item("entry", [], { rendered: { body: [[{ text: "note" }]] } }), item("summary", [text("earlier chat")])], { running: false });
  expect(turns[0]!.segments.map((s) => s.kind)).toEqual(["text", "custom", "summary"]);
  const body = turns[0]!.segments[0]!;
  expect(body.kind === "text" && body.detail).toEqual({ id: clipped.id, part: 0 });
  expect(clippedPart(clipped)).toEqual({ id: clipped.id, part: 0 });
  expect(itemText(item("user", [text("a"), text("b")]))).toBe("a\nb");
});

test("a call's diff and images come out of its activity into the message, in order", () => {
  n = 0;
  const details = { patch: ["--- a.ts", "+++ a.ts", "@@ -1 +1 @@", "-a", "+b", ""].join(String.fromCharCode(10)), diff: "x" };
  const turns = buildTurns(
    [
      item("user", [text("go")]),
      item("assistant", [call("c1", "read", { path: "a.ts" }), call("c2", "edit", { path: "a.ts" }), call("c3", "bash")]),
      result("c1"),
      item("toolResult", [text("edited"), { type: "image", mimeType: "image/png", bytes: 213 }], { callId: "c2", details, toolName: "edit" }),
      result("c3"),
    ],
    { running: false },
  );
  expect(turns[0]!.segments.map((s) => s.kind)).toEqual(["activity", "diff", "image", "activity"]);
  const diff = turns[0]!.segments[1]!;
  expect(diff.kind === "diff" && diff.path).toBe("a.ts");
  const image = turns[0]!.segments[2]!;
  expect(image.kind === "image" && [image.part, image.mimeType, image.itemId]).toEqual([1, "image/png", expect.any(String)]);
  const first = turns[0]!.segments[0]!;
  expect(first.kind === "activity" && first.calls.map((c) => c.name)).toEqual(["read", "edit"]);
});

test("an SVG a tool wrote is drawn from its arguments once the write is done", () => {
  n = 0;
  const svg = { path: "icon.svg", content: "<svg xmlns='http://www.w3.org/2000/svg'/>" };
  const withResult = buildTurns([item("user", [text("go")]), item("assistant", [call("w", "write", svg)]), result("w")], { running: false });
  expect(withResult[0]!.segments.map((s) => s.kind)).toEqual(["activity", "svg"]);
  const running = buildTurns([item("user", [text("go")]), item("assistant", [call("w", "write", svg)])], { running: true });
  expect(running[0]!.segments.map((s) => s.kind)).toEqual(["activity"]);
  const notSvg = buildTurns([item("user", [text("go")]), item("assistant", [call("w", "write", { path: "a.txt", content: "<svg/>" })]), result("w")], { running: false });
  expect(notSvg[0]!.segments.map((s) => s.kind)).toEqual(["activity"]);
});

const tc = (name: string, args: Record<string, string> = {}) => ({ id: name, name, args, status: "done" as const });

test("calls are described in words and grouped into one line", () => {
  expect(describeCall(tc("edit", { path: "src/a/demo.ts" }))).toMatchObject({ doing: "Editing", done: "Edited", object: "demo.ts" });
  expect(describeCall(tc("bash", { command: "npm test\nand more" })).object).toBe("npm test");
  expect(describeCall(tc("hello"))).toMatchObject({ doing: "Using hello", done: "Used hello" });
  expect(describeCall(tc("write")).object).toBeUndefined();
  expect(
    summarizeCalls([
      tc("read", { path: "a" }),
      tc("read", { path: "b" }),
      tc("edit", { path: "demo.ts" }),
      tc("bash", { command: "x" }),
      tc("bash", { command: "y" }),
      tc("hello"),
    ]),
  ).toBe("Read 2 files, edited demo.ts, ran 2 commands, used hello");
  // Things are listed in the order they first happened; tools of one group share a phrase.
  expect(summarizeCalls([tc("bash", { command: "x" }), tc("write", { path: "a.txt" }), tc("bash", { command: "y" })])).toBe("Ran 2 commands, wrote a.txt");
  expect(summarizeCalls([tc("grep", { pattern: "a" }), tc("ls", { path: "." }), tc("find", { pattern: "b" })])).toBe("Searched 3 times");
  expect(summarizeCalls([tc("bash")])).toBe("Ran 1 command");
});

test("a running call carries what it has output so far; a finished one does not", () => {
  n = 0;
  const items = [item("user", [text("go")]), item("assistant", [call("c1", "bash", { command: "make" }), call("c2", "bash")]), result("c2")];
  const progress = { c1: { output: "compiling\n" }, c2: { output: "stale" } };
  const segment = buildTurns(items, { running: true, progress })[0]!.segments[0]!;
  expect(segment.kind === "activity" && segment.calls.map((c) => c.progress?.output)).toEqual(["compiling\n", undefined]);
});

test("a tool an extension placed a component for is drawn by it alone; custom items map to their point", () => {
  n = 0;
  const details = { patch: ["--- a.ts", "+++ a.ts", "@@ -1 +1 @@", "-a", "+b", ""].join(String.fromCharCode(10)) };
  const items = [
    item("user", [text("go")]),
    item("assistant", [call("c1", "edit", { path: "a.ts" })]),
    item("toolResult", [text("edited")], { callId: "c1", details, toolName: "edit" }),
    item("custom", [text("saved")], { customType: "note" }),
  ];
  const plain = buildTurns(items, { running: false });
  expect(plain[0]!.segments.map((s) => s.kind)).toEqual(["activity", "diff", "custom"]);
  const placed = buildTurns(items, { running: false, placed: (point) => point === "item.tool:edit" });
  // The component is the whole call: no activity line, no default diff.
  expect(placed[0]!.segments.map((s) => s.kind)).toEqual(["view", "custom"]);
  const [view, custom] = placed[0]!.segments;
  expect(pointOf(view!)).toEqual({ point: "item.tool:edit", data: expect.objectContaining({ name: "edit", status: "done" }) });
  expect(pointOf(custom!)).toEqual({ point: "item.custom:note", data: expect.objectContaining({ customType: "note" }) });
  expect(pointOf(plain[0]!.segments[0]!)).toBeUndefined();
});

test("a notice kept in the chat's history is a notice where it happened", () => {
  n = 0;
  const [turn] = buildTurns(
    [
      item("user", [text("go")]),
      item("entry", [], { customType: "pispark:notice", details: { kind: "warning", lines: [[{ text: "Heads up" }]], at: 1 } }),
      item("assistant", [text("done")]),
    ],
    { running: false },
  );
  expect(turn!.segments.map((s) => s.kind)).toEqual(["notice", "text"]);
  expect(turn!.segments[0]).toMatchObject({ notice: { kind: "warning", lines: [[{ text: "Heads up" }]] } });
});

test("PiSpark's session tool: words for each action, and the session a start made, with its id", () => {
  const id = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
  const call = {
    id: "c1",
    name: "pispark_session",
    args: { action: "start", prompt: "research", title: "Zustand research" },
    status: "done" as const,
    result: item("toolResult", [{ type: "text", text: `Started "Zustand research" (id ${id}). It works on its own.` }]),
  };
  expect(describeCall(call).done).toBe("Started Zustand research");
  expect(summarizeCalls([call, call])).toBe("Started 2 sessions");
  expect(artifactsOf(call)).toEqual([{ kind: "session", key: "session.c1", sessionId: id, title: "Zustand research" }]);
  expect(artifactsOf({ ...call, args: { action: "list" } })).toEqual([]);
});
