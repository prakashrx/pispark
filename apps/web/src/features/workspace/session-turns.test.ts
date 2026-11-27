import { expect, test } from "vitest";
import type { Item, ItemPart } from "../../../../server/src/contract/protocol";
import { buildTurns, clippedPart, itemText, wokenFrom } from "./session-turns";
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

test("a summary between your messages stands on its own; one in the middle of the work stays in its turn", () => {
  n = 0;
  const summary = (tokensBefore?: number) => item("summary", [text("so far")], tokensBefore ? { tokensBefore } : {});
  const between = buildTurns([item("user", [text("a")]), item("assistant", [text("A")]), summary(198_484), item("user", [text("b")]), item("assistant", [text("B")])], { running: false });
  expect(between.map((t) => [t.user ? itemText(t.user) : null, t.segments.map((s) => s.kind)])).toEqual([
    ["a", ["text"]],
    [null, ["summary"]],
    ["b", ["text"]],
  ]);
  expect(between[1]!.segments[0]).toMatchObject({ kind: "summary", between: true, tokensBefore: 198_484 });
  const inRun = buildTurns([item("user", [text("a")]), item("assistant", [call("c1", "read")]), result("c1"), summary(), item("assistant", [text("A")])], { running: false });
  expect(inRun).toHaveLength(1);
  expect(inRun[0]!.segments.map((s) => s.kind)).toEqual(["activity", "summary", "text"]);
  expect(inRun[0]!.segments[1]).toMatchObject({ kind: "summary", between: false });
  // Just made while the work goes on: in the turn, which is still running.
  const live = buildTurns([item("user", [text("a")]), item("assistant", [call("c1", "read")]), result("c1"), summary()], { running: true });
  expect(live).toHaveLength(1);
  expect(live[0]!.running).toBe(true);
  // A manual Compact once the work is done, or before a wake's message, is between.
  expect(buildTurns([item("user", [text("a")]), item("assistant", [text("A")]), summary()], { running: false })).toHaveLength(2);
});

test("custom entries, summaries and clipped parts keep their identity", () => {
  n = 0;
  const clipped = item("assistant", [text("start", 500)]);
  const turns = buildTurns([item("user", [text("q")]), clipped, item("entry", [], { rendered: { body: [[{ text: "note" }]] } }), item("summary", [text("earlier session")])], { running: false });
  expect(turns[0]!.segments.map((s) => s.kind)).toEqual(["text", "custom"]);
  expect(turns[1]!.segments.map((s) => s.kind)).toEqual(["summary"]);
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

test("a notice kept in the session's history is a notice where it happened", () => {
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

test("starting a session: its words, and the session it made as a row, with its id", () => {
  const id = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
  const call = {
    id: "c1",
    name: "pispark_start_session",
    args: { brief: "research", title: "Zustand research" },
    status: "done" as const,
    result: item("toolResult", [{ type: "text", text: `Started "Zustand research" (session-1). It works on its own.` }], { details: { id } }),
  };
  expect(describeCall(call).done).toBe("Started Zustand research");
  expect(summarizeCalls([call, call])).toBe("Started 2 sessions");
  expect(artifactsOf(call)).toEqual([{ kind: "session", key: "session.c1", sessionId: id, title: "Zustand research" }]);
  // The id comes from the call's details, not from its words.
  expect(artifactsOf({ ...call, result: { ...call.result, details: undefined } })).toEqual([]);
  // The other verbs name the child by its handle, and put no row in the message.
  const verb = (name: string, args: object) => ({ ...call, name: `pispark_${name}`, args: args as typeof call.args, result: item("toolResult", [text("ok")]) });
  expect(describeCall(verb("send", { id: "session-1", text: "go on" }))).toEqual({ doing: "Sending to", done: "Sent to", object: "session-1" });
  expect(describeCall(verb("wait", { ids: ["session-1", "process-2"] }))).toEqual({ doing: "Waiting for", done: "Waited for", object: "session-1, process-2" });
  expect(describeCall(verb("look", {}))).toEqual({ doing: "Looking at", done: "Looked at", object: "what it started" });
  expect(describeCall(verb("stop", { id: "process-2" }))).toEqual({ doing: "Stopping", done: "Stopped", object: "process-2" });
  expect(describeCall(verb("raise", { text: "Postgres or SQLite?" }))).toEqual({ doing: "Raising", done: "Raised", object: "Postgres or SQLite?" });
  expect(describeCall(verb("note", { text: "half way" }))).toEqual({ doing: "Noting", done: "Noted", object: "half way" });
  expect(describeCall(verb("self", { action: "reload" })).done).toBe("Asked to reload");
  expect(artifactsOf(verb("stop", { id: "session-1" }))).toEqual([]);
  expect(summarizeCalls([verb("note", { text: "a" }), verb("note", { text: "b" }), verb("look", {})])).toBe("Left 2 notes, looked 1 time");
  // A start from before the ten verbs, in an older conversation, still shows what it made.
  const older = { ...call, name: "pispark_session", args: { action: "start", title: "Zustand research" } as unknown as typeof call.args };
  expect(artifactsOf(older)).toEqual([{ kind: "session", key: "session.c1", sessionId: id, title: "Zustand research" }]);
  expect(artifactsOf({ ...older, args: { action: "list" } as unknown as typeof call.args })).toEqual([]);
});

test("sessions started one after another are one list under one activity line", () => {
  n = 0;
  const a = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
  const b = "7f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
  const turns = buildTurns(
    [
      item("user", [text("research both")]),
      item("assistant", [call("c1", "pispark_start_session", { title: "Math" }), call("c2", "pispark_start_session", { title: "Capital" })]),
      item("toolResult", [text('Started "Math" (session-1).')], { callId: "c1", toolName: "pispark_start_session", details: { id: a } }),
      item("toolResult", [text('Started "Capital" (session-2).')], { callId: "c2", toolName: "pispark_start_session", details: { id: b } }),
    ],
    { running: false },
  );
  expect(turns[0]!.segments.map((s) => s.kind)).toEqual(["activity", "session", "session"]);
  const activity = turns[0]!.segments[0]!;
  expect(activity.kind === "activity" && activity.calls).toHaveLength(2);
});

test("a status line is its own segment; a report card is drawn from what the server sent", () => {
  n = 0;
  const turns = buildTurns(
    [
      item("user", [text("go")]),
      item("assistant", [text("ok")]),
      item("custom", [text('The session "Quiet" you started finished.')], {
        customType: "pispark:status",
        details: { session: "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b", title: "Quiet", how: "finished", ok: true },
      }),
    ],
    { running: false },
  );
  expect(turns[0]!.segments.at(-1)).toEqual({
    kind: "status",
    key: turns[0]!.segments.at(-1)!.key,
    title: "Quiet",
    how: "finished",
    ok: true,
    session: "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b",
  });
  // A report card is whose it is, how it ended, and where the report starts, as the server sent them.
  const source = { kind: "process", id: "p1", label: "tests · exited 1" };
  expect(wokenFrom({ source, due: "x", card: { title: "tests", how: "exited 1", start: 12 } })).toEqual({ ...source, title: "tests", how: "exited 1", start: 12 });
  // An older one without a card shows its label and all of its text.
  expect(wokenFrom({ source, due: "x" })).toEqual({ ...source, title: "tests · exited 1", start: 0 });
});

test("one row per ask: a child's answer folds into its row, its arrival is a quiet line, and its notes are not lines of their own", () => {
  n = 0;
  const child = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
  const clock = "7f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
  const heading = 'The session "Reviewer" (session-1) you started finished:\n\n';
  const turns = buildTurns(
    [
      item("user", [text("review the change")]),
      item("assistant", [call("c1", "pispark_start_session", { brief: "review", title: "Reviewer" })]),
      item("toolResult", [text('Started "Reviewer" (session-1).')], { callId: "c1", toolName: "pispark_start_session", details: { id: child } }),
      // The child's note, and the end of a scheduled run that has no row here.
      item("custom", [text('"Reviewer" (session-1) notes: half way')], { customType: "pispark:status", details: { session: child, title: "Reviewer", how: "notes: half way" } }),
      item("custom", [text('The session "9:00 am run" you started finished.')], { customType: "pispark:status", details: { session: clock, title: "9:00 am run", how: "finished", ok: true } }),
      item("entry", [], { customType: "pispark:woken", details: { source: { kind: "session", id: child, label: "Reviewer · finished" }, due: "x", card: { title: "Reviewer", how: "finished", start: heading.length } } }),
      item("user", [text(`${heading}Looks **good**.`)]),
      item("assistant", [text("The review is in.")]),
    ],
    { running: false },
  );
  // The row holds the answer, after the line the agent needs.
  expect(turns[0]!.segments.find((segment) => segment.kind === "session")).toMatchObject({ sessionId: child, title: "Reviewer", answer: "Looks **good**." });
  // The child's own line is gone; the scheduled run's stays.
  expect(turns[0]!.segments.filter((segment) => segment.kind === "status").map((segment) => segment.kind === "status" && segment.title)).toEqual(["9:00 am run"]);
  // Where the answer arrived, the turn only says so.
  expect(turns[1]!.from).toMatchObject({ kind: "session", id: child, title: "Reviewer", how: "finished", folded: true });

  // A raise is read where it arrives: it is not folded. Nor is an answer from a child with no row here.
  const raised = buildTurns(
    [
      item("assistant", [call("c1", "pispark_start_session", { title: "Reviewer" })]),
      item("toolResult", [text("Started.")], { callId: "c1", toolName: "pispark_start_session", details: { id: child } }),
      item("entry", [], { customType: "pispark:woken", details: { source: { kind: "session", id: child, label: "Reviewer · raised" }, due: "x", card: { title: "Reviewer", how: "raised", start: 0 } } }),
      item("user", [text("A or B?")]),
      item("entry", [], { customType: "pispark:woken", details: { source: { kind: "session", id: clock, label: "Elsewhere · finished" }, due: "x", card: { title: "Elsewhere", how: "finished", start: 0 } } }),
      item("user", [text("done")]),
    ],
    { running: false },
  );
  expect(raised.map((turn) => turn.from?.folded)).toEqual([undefined, undefined, undefined]);
  expect(raised[0]!.segments.find((segment) => segment.kind === "session")).not.toHaveProperty("answer");
});

test("several messages that arrived as one are one turn, with each sender and where its part starts", () => {
  n = 0;
  const lint = { kind: "process", id: "p1", label: "lint · exited 0" };
  const reviewer = { kind: "session", id: "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b", label: "Reviewer · finished" };
  const first = 'The process "lint" (process-1) exited 0.\n\nLast output:\nclean';
  const second = 'The session "Reviewer" (session-2) you started finished:\n\nLooks good.';
  const turns = buildTurns(
    [
      item("entry", [], {
        customType: "pispark:woken",
        details: {
          source: lint,
          due: "x",
          card: { title: "lint", how: "exited 0", start: 55 },
          together: [
            { source: lint, card: { title: "lint", how: "exited 0", start: 55 }, at: 0 },
            { source: reviewer, card: { title: "Reviewer", how: "finished", start: 58 }, at: first.length + 2 },
          ],
        },
      }),
      item("user", [text(`${first}\n\n${second}`)]),
      item("assistant", [text("Both are in.")]),
    ],
    { running: false },
  );
  expect(turns).toHaveLength(1);
  const { together } = turns[0]!;
  expect(together!.map((part) => [part.kind, part.title, part.how])).toEqual([
    ["process", "lint", "exited 0"],
    ["session", "Reviewer", "finished"],
  ]);
  // Each part's report is its text after the line the agent needs, up to where the next part starts.
  const whole = `${first}\n\n${second}`;
  expect(together!.map((part, index) => whole.slice(part.at + part.start, together![index + 1]?.at).trimEnd())).toEqual(["clean", "Looks good."]);
  // A message of one has no parts.
  expect(buildTurns([item("entry", [], { customType: "pispark:woken", details: { source: lint, due: "x" } }), item("user", [text(first)])], { running: false })[0]!.together).toBeUndefined();
});

test("starting a process: its words, and the process it made as a row", () => {
  const id = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
  const started = {
    id: "p1",
    name: "pispark_start_process",
    args: { command: "npm run dev", title: "dev server" },
    status: "done" as const,
    result: item("toolResult", [text("Started process-1: dev server (npm run dev) — running since now in /work.")], { details: { id } }),
  };
  expect(describeCall(started)).toEqual({ doing: "Starting", done: "Started", object: "dev server" });
  expect(summarizeCalls([started])).toBe("Started 1 process");
  expect(artifactsOf(started)).toEqual([{ kind: "process", key: "process.p1", processId: id, title: "dev server" }]);
});

test("the schedule tool: words from the schedule as saved, and the schedule an add made as a row", () => {
  const schedule = { id: "5e6be256-39c5-4dcb-a848-8e9cf3390a36", sessionId: "s", cron: "0 7 * * *", prompt: "Feed", on: true, createdAt: "now", by: "agent", run: "new", runs: [] };
  const added = {
    id: "c9",
    name: "pispark_schedule",
    args: { cron: "0 7 * * *", prompt: "Feed", run: "new" },
    status: "done" as const,
    result: item("toolResult", [text("Scheduled (schedule-1): Every day at 7:00 am, each run in a new session.")], { details: { schedule } }),
  };
  expect(describeCall(added)).toEqual({ doing: "Adding a schedule", done: "Scheduled every day at 7:00 am" });
  expect(summarizeCalls([added])).toBe("Added 1 schedule");
  expect(artifactsOf(added)).toEqual([{ kind: "schedule", key: "schedule.c9", schedule }]);
  // Declined, or from a host that sends no details: no row, and nothing claimed.
  const declined = { ...added, id: "c10", result: item("toolResult", [text("The person declined; nothing was scheduled.")]) };
  expect(describeCall(declined).done).toBe("Added no schedule");
  expect(artifactsOf(declined)).toEqual([]);
});

test("a turn knows when it started and when its last response ended", () => {
  const items: Item[] = [
    { key: "u1", role: "user", at: 1_000, parts: [{ type: "text", text: "go" }] },
    { key: "a1", role: "assistant", at: 1_200, durationMs: 800, parts: [{ type: "toolCall", id: "c1", name: "read", args: {} }] },
    { key: "r1", role: "toolResult", at: 2_500, callId: "c1", toolName: "read", parts: [{ type: "text", text: "ok" }] },
    { key: "a2", role: "assistant", at: 2_600, durationMs: 100_000, parts: [{ type: "text", text: "done" }] },
    // A note added minutes later is not part of the agent's work.
    { key: "c1", role: "custom", at: 900_000, customType: "note", parts: [{ type: "text", text: "dev server was stopped" }] },
    { key: "u2", role: "user", parts: [{ type: "text", text: "no times" }] },
  ];
  const [first, second] = buildTurns(items, { running: false });
  expect([first!.startedAt, first!.endedAt]).toEqual([1_000, 102_600]);
  expect([second!.startedAt, second!.endedAt]).toEqual([undefined, undefined]);
});

test("a failed reply says why with the provider's words; Pi retrying it shows no card; only the latest offers Retry", () => {
  const user = item("user", [text("answer")]);
  const failed = item("assistant", [], { stopReason: "error", failure: "unavailable", error: "529 Overloaded", provider: "anthropic" });
  // While the turn still runs, the failure is one Pi is retrying.
  expect(buildTurns([user, failed], { running: true })[0]?.segments.some((segment) => segment.kind === "stopped")).toBe(false);
  expect(buildTurns([user, failed], { running: false })[0]?.segments).toContainEqual({
    kind: "stopped", key: `${failed.key}.stop`, reason: "unavailable", error: "529 Overloaded", provider: "anthropic", latest: true,
  });
  const next = item("user", [text("something else")]);
  const stopped = buildTurns([user, failed, next], { running: false })[0]?.segments.find((segment) => segment.kind === "stopped");
  expect(stopped).toMatchObject({ reason: "unavailable", latest: false });
});

test("a usage-limit card describes the terminal failure and disappears after a successful retry", () => {
  const user = item("user", [text("answer")]);
  const limit = item("assistant", [], { stopReason: "error", failure: "usage-limit" });
  const done = item("assistant", [text("complete")], { stopReason: "stop" });
  expect(buildTurns([user, limit], { running: false })[0]?.segments)
    .toContainEqual({ kind: "stopped", key: `${limit.key}.stop`, reason: "usage-limit", latest: true });
  expect(buildTurns([user, limit, done], { running: false })[0]?.segments.map((segment) => segment.kind))
    .toEqual(["text"]);
});

test("an answered question is its own item where it was asked, saved or live; a notice that only reads like one stays a notice", () => {
  n = 0;
  const [turn] = buildTurns(
    [
      item("user", [text("go")]),
      item("assistant", [call("c1", "schedule")]),
      result("c1"),
      item("entry", [], { customType: "pispark:notice", details: { kind: "info", lines: [], answered: { question: "Schedule this?", said: "yes" }, at: 1 } }),
      item("entry", [], { customType: "pispark:notice", details: { kind: "info", lines: [[{ text: "Disk — answered" }]], at: 2 } }),
      item("assistant", [text("done")]),
    ],
    { running: false, notices: [{ id: 1, kind: "info", lines: [], answered: { question: "Pick one", said: "chose", choice: "two" }, after: 99, at: 3 }] },
  );
  expect(turn!.segments.map((s) => s.kind)).toEqual(["activity", "answered", "notice", "text", "answered"]);
  expect(turn!.segments[1]).toMatchObject({ answered: { question: "Schedule this?", said: "yes" } });
  expect(turn!.segments[4]).toMatchObject({ answered: { question: "Pick one", said: "chose", choice: "two" } });
});
