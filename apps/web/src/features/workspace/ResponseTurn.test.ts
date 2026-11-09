import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { expect, test } from "vitest";
import type { Item } from "../../../../server/src/protocol";
import { buildTurns } from "./chat-turns";
import ResponseTurn from "./ResponseTurn.svelte";

const patch = ["--- demo.ts", "+++ demo.ts", "@@ -1,2 +1,2 @@", " keep", "-old line", "+new line", ""].join("\n");
let n = 0;
const item = (role: Item["role"], parts: Item["parts"], extra: Partial<Item> = {}): Item => ({ id: `e${++n}`, key: `k${n}`, role, parts, ...extra });
const turn = (items: Item[]) => buildTurns(items, { running: false })[0]!;

test("an edit's changes are read in the message: numbered lines, signs, counts, and a card that folds", async () => {
  const items = [
    item("user", [{ type: "text", text: "tidy" }]),
    item("assistant", [{ type: "toolCall", id: "c1", name: "edit", args: { path: "demo.ts" } }, { type: "text", text: "Done." }]),
    item("toolResult", [{ type: "text", text: "ok" }], { callId: "c1", toolName: "edit", details: { patch, diff: "" } }),
  ];
  render(ResponseTurn, { turn: turn(items), sessionId: "s1" });
  const card = screen.getByRole("figure", { name: "Changes to demo.ts" });
  expect(card.textContent).toContain("old line");
  expect(card.textContent).toContain("new line");
  expect(screen.getByLabelText("1 lines added").textContent).toBe("+1");
  expect(screen.getByLabelText("1 lines removed").textContent).toBe("−1");
  expect(screen.getByLabelText("removed").textContent).toBe("−");
  const head = within(card).getByRole("button");
  expect(head.getAttribute("aria-expanded")).toBe("true");
  await fireEvent.click(head);
  expect(head.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("region", { name: /Lines changed/ })).toBeNull();
  // The reply that follows is still there, after the card.
  expect(screen.getByText("Done.")).toBeTruthy();
});

test("pictures are drawn as images from the saved result or from the SVG a tool wrote, never as markup", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>';
  const items = [
    item("user", [{ type: "text", text: "draw" }]),
    item("assistant", [
      { type: "toolCall", id: "r", name: "read", args: { path: "dot.png" } },
      { type: "toolCall", id: "w", name: "write", args: { path: "icon.svg", content: svg } },
    ]),
    item("toolResult", [{ type: "text", text: "Read image" }, { type: "image", mimeType: "image/png", bytes: 213 }], { id: "res1", callId: "r", toolName: "read" }),
    item("toolResult", [{ type: "text", text: "Wrote" }], { callId: "w", toolName: "write" }),
  ];
  const { container } = render(ResponseTurn, { turn: turn(items), sessionId: "s1" });
  const [png, drawn] = [...container.querySelectorAll("img")];
  expect(png!.getAttribute("src")).toBe("/api/sessions/s1/items/res1/parts/1");
  expect(png!.getAttribute("alt")).toBe("Image from read");
  expect(drawn!.getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  expect(drawn!.getAttribute("alt")).toBe("icon.svg");
  expect(container.querySelector("svg script, script, [onload]")).toBeNull();
});

test("a very large change shows its start with a way to see all of it, and a cut one says so", async () => {
  const many = ["--- big.ts", "+++ big.ts", "@@ -1,0 +1,900 @@", ...Array.from({ length: 900 }, (_, i) => `+line ${i}`), ""].join(String.fromCharCode(10));
  const items = [
    item("user", [{ type: "text", text: "go" }]),
    item("assistant", [{ type: "toolCall", id: "big", name: "edit", args: { path: "big.ts" } }]),
    item("toolResult", [{ type: "text", text: "ok" }], { callId: "big", toolName: "edit", details: { patch: many }, clipped: true }),
  ];
  const { container } = render(ResponseTurn, { turn: turn(items), sessionId: "s1" });
  expect(container.querySelectorAll(".row")).toHaveLength(400);
  expect(screen.getByRole("note").textContent).toContain("too large to send whole");
  await fireEvent.click(screen.getByRole("button", { name: "Show all 900 lines" }));
  expect(container.querySelectorAll(".row")).toHaveLength(900);
});

test("an SVG whose markup was cut is not drawn half; the reason is given", () => {
  const items = [
    item("user", [{ type: "text", text: "draw" }]),
    item("assistant", [{ type: "toolCall", id: "w", name: "write", args: { path: "big.svg", content: "<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0" }, clipped: true }]),
    item("toolResult", [{ type: "text", text: "Wrote" }], { callId: "w", toolName: "write" }),
  ];
  const { container } = render(ResponseTurn, { turn: turn(items), sessionId: "s1" });
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("big.svg is too large to draw here.")).toBeTruthy();
});

test("while a call runs, the end of its output shows under the activity line", () => {
  const items = [
    item("user", [{ type: "text", text: "build" }]),
    item("assistant", [{ type: "toolCall", id: "b", name: "bash", args: { command: "make" } }]),
  ];
  const output = Array.from({ length: 10 }, (_, i) => `line ${i}`).join(String.fromCharCode(10));
  const live = buildTurns(items, { running: true, progress: { b: { output } } })[0]!;
  const { container } = render(ResponseTurn, { turn: live, sessionId: "s1" });
  expect(screen.getByRole("button", { name: "Running make…" })).toBeTruthy();
  const shown = container.querySelector(".activity-progress")!.textContent!;
  expect(shown.split(String.fromCharCode(10))).toEqual(["line 4", "line 5", "line 6", "line 7", "line 8", "line 9"]);
});

test("the element drawn while streaming is the one that stays after the commit", async () => {
  const live = (text: string, extra: Partial<Item> = {}) => ({ key: "t1", role: "assistant" as const, parts: [{ type: "thinking" as const, text: "plan" }, { type: "text" as const, text }], ...extra });
  const user = item("user", [{ type: "text", text: "hi" }]);
  const streaming = buildTurns([user, live("Hel")], { running: true })[0]!;
  const { container, rerender } = render(ResponseTurn, { turn: streaming, sessionId: "s1" });
  const prose = container.querySelector(".prose")!;
  const thought = container.querySelector(".thought")!;
  await rerender({ turn: buildTurns([user, live("Hello")], { running: true })[0]!, sessionId: "s1" });
  // Committed: Pi's entry id arrives, the key does not change, so nothing is drawn anew.
  await rerender({ turn: buildTurns([user, live("Hello, world", { id: "e99" })], { running: false })[0]!, sessionId: "s1" });
  expect(container.querySelector(".prose")).toBe(prose);
  expect(prose.isConnected).toBe(true);
  expect(prose.textContent).toContain("Hello, world");
  expect(container.querySelector(".thought")).toBe(thought);
});

test("an activity that gains a call keeps its element", async () => {
  const user = item("user", [{ type: "text", text: "go" }]);
  const first = { key: "a1", role: "assistant" as const, parts: [{ type: "toolCall" as const, id: "c1", name: "read", args: { path: "a" } }] };
  const second = { key: "a2", role: "assistant" as const, parts: [{ type: "toolCall" as const, id: "c2", name: "read", args: { path: "b" } }] };
  const { container, rerender } = render(ResponseTurn, { turn: buildTurns([user, first], { running: true })[0]!, sessionId: "s1" });
  const activity = container.querySelector("[data-purpose=activity]")!;
  await rerender({ turn: buildTurns([user, first, second], { running: true })[0]!, sessionId: "s1" });
  expect(container.querySelectorAll("[data-purpose=activity]")).toHaveLength(1);
  expect(container.querySelector("[data-purpose=activity]")).toBe(activity);
});
