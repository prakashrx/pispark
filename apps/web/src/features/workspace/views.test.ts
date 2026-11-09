import { render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, expect, test } from "vitest";
import type { Item } from "../../../../server/src/protocol";
import { buildTurns } from "./chat-turns";
import ResponseTurn from "./ResponseTurn.svelte";
import { artifactsOf } from "./tool-views";
import BarView from "./testing/BarView.svelte";
import OtherDiff from "./testing/OtherDiff.svelte";
import { registerSegmentView, registerToolView, resolveSegmentView, resolveToolView } from "./views.svelte";
import "./default-views";

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});
const keep = (dispose: () => void) => {
  disposers.push(dispose);
  return dispose;
};

let n = 0;
const item = (role: Item["role"], parts: Item["parts"], extra: Partial<Item> = {}): Item => ({ id: `e${++n}`, key: `k${n}`, role, parts, ...extra });
const turnWithHello = (details: unknown = { values: [1, 2, 3] }) =>
  buildTurns(
    [
      item("user", [{ type: "text", text: "go" }]),
      item("assistant", [{ type: "toolCall", id: "h", name: "hello", args: { who: "Ada" } }]),
      item("toolResult", [{ type: "text", text: "Hello, Ada!" }], { callId: "h", toolName: "hello", details: details as never }),
    ],
    { running: false },
  )[0]!;

test("the defaults are registered through the same calls an extension uses, and unknown things have a fallback", () => {
  for (const kind of ["text", "thinking", "activity", "custom", "summary", "diff", "image", "svg", "notice", "stopped"])
    expect(resolveSegmentView(kind), kind).toBeTruthy();
  expect(resolveSegmentView("charts:bar")).toBeUndefined();
  expect(resolveToolView("edit").describe({ id: "x", name: "edit", args: { path: "a/b.ts" }, status: "done" }).object).toBe("b.ts");
  // A tool nobody described is described by its name.
  expect(resolveToolView("unheard-of").describe({ id: "x", name: "unheard-of", args: {}, status: "done" })).toEqual({ doing: "Using unheard-of", done: "Used unheard-of" });
});

test("the newest registration wins, and disposing it brings the previous one back", () => {
  const original = resolveSegmentView("diff");
  const first = keep(registerSegmentView("diff", OtherDiff as never));
  expect(resolveSegmentView("diff")).toBe(OtherDiff);
  const second = keep(registerSegmentView("diff", BarView as never));
  expect(resolveSegmentView("diff")).toBe(BarView);
  second();
  expect(resolveSegmentView("diff")).toBe(OtherDiff);
  first();
  expect(resolveSegmentView("diff")).toBe(original);
  // Disposing out of order or twice does no harm.
  const a = registerSegmentView("diff", OtherDiff as never);
  const b = registerSegmentView("diff", BarView as never);
  a();
  expect(resolveSegmentView("diff")).toBe(BarView);
  b();
  b();
  expect(resolveSegmentView("diff")).toBe(original);
});

test("an extension's view of its own tool puts a segment of its own kind in the message", () => {
  expect(turnWithHello().segments.map((s) => s.kind)).toEqual(["activity"]);
  keep(registerToolView("hello", {
    describe: (call) => ({ doing: "Greeting", done: "Greeted", object: String((call.args as { who: string }).who) }),
    summarize: (calls) => `greeted ${calls.length}`,
    artifacts: (call) => [{ kind: "charts:bar", key: `bar.${call.id}`, values: (call.result?.details as { values: number[] }).values }],
  }));
  keep(registerSegmentView("charts:bar", BarView as never));
  const turn = turnWithHello();
  expect(turn.segments.map((s) => s.kind)).toEqual(["activity", "charts:bar"]);
  const { container } = render(ResponseTurn, { turn, sessionId: "s1" });
  expect(screen.getByLabelText("Bars").textContent).toBe("1,2,3");
  expect(screen.getByRole("button", { name: "Greeted 1" })).toBeTruthy();
  expect(container.querySelectorAll("[data-purpose=activity]")).toHaveLength(1);
});

test("a view that does not say what it contributes still gets the generic diff and pictures", () => {
  keep(registerToolView("hello", { describe: () => ({ doing: "Greeting", done: "Greeted" }) }));
  const patch = ["--- a", "+++ a", "@@ -1 +1 @@", "-x", "+y", ""].join(String.fromCharCode(10));
  const turn = turnWithHello({ patch });
  expect(turn.segments.map((s) => s.kind)).toEqual(["activity", "diff"]);
  const call = (turn.segments[0] as { calls: Parameters<typeof artifactsOf>[0][] }).calls[0]!;
  expect(artifactsOf(call).map((s) => s.kind)).toEqual(["diff"]);
});

test("a view registered after the chat is on screen redraws it, and disposing removes it again", async () => {
  const turn = buildTurns([item("user", [{ type: "text", text: "go" }]), item("assistant", [{ type: "text", text: "Here" }])], { running: false })[0]!;
  turn.segments.push({ kind: "charts:bar", key: "late", values: [4, 5] });
  render(ResponseTurn, { turn, sessionId: "s1" });
  expect(screen.queryByLabelText("Bars")).toBeNull();
  const dispose = registerSegmentView("charts:bar", BarView as never);
  await tick();
  expect(screen.getByLabelText("Bars").textContent).toBe("4,5");
  dispose();
  await tick();
  expect(screen.queryByLabelText("Bars")).toBeNull();
});

test("a replacement view for a built-in kind takes over its segments", async () => {
  const patch = ["--- a", "+++ a", "@@ -1 +1 @@", "-x", "+y", ""].join(String.fromCharCode(10));
  const turn = turnWithHello({ patch });
  render(ResponseTurn, { turn, sessionId: "s1" });
  expect(screen.getByRole("figure", { name: /Changes to/ })).toBeTruthy();
  keep(registerSegmentView("diff", OtherDiff as never));
  await tick();
  expect(screen.queryByRole("figure", { name: /Changes to/ })).toBeNull();
  expect(screen.getByText(/Custom diff of \d+ characters/)).toBeTruthy();
});
