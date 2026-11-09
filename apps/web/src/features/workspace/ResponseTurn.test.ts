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
