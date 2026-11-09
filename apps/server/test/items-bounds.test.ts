import assert from "node:assert/strict";
import test from "node:test";
import type { Item } from "../src/protocol.js";
import { boundTail } from "../src/runtime/items.js";
import { SessionRuntime } from "../src/runtime/session-runtime.js";
import { testHome } from "./fixtures/home.js";

/** Ordinary Pi extension tools whose results are larger than the chat sends whole. */
const LARGE = `
const lines = (n) => Array.from({ length: n }, (_, i) => "+line " + i).join("\\n");
export default function (pi) {
  pi.registerTool({
    name: "bigpatch", label: "Big patch", description: "x", parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: "done" }], details: { patch: "@@ -1 +1,40000 @@\\n" + lines(40000), note: "y".repeat(100) } };
    },
  });
  pi.registerTool({
    name: "huge", label: "Huge", description: "x", parameters: { type: "object", properties: {} },
    async execute() {
      // Escaped characters make the serialized item much larger than its character count.
      const quoted = '"'.repeat(200000);
      return { content: [{ type: "text", text: quoted }], details: { patch: quoted, diff: quoted } };
    },
  });
}
`;

/** Every item, paging back through history (pages are bounded by bytes). */
function everything(runtime: SessionRuntime, id: string): Item[] {
  const items: Item[] = [];
  let page = runtime.items(id, {});
  for (;;) {
    items.unshift(...page.items);
    if (!page.more) return items;
    page = runtime.items(id, { before: page.items[0]!.id! });
  }
}

test("a patch over the limit is cut, and the item says so; small details are sent whole", async () => {
  const h = await testHome("pispark-bounds-");
  try {
    await h.persona("default", { name: "Default" }, { "extensions/large.mjs": LARGE });
    h.provider.automatic = true;
    const runtime = new SessionRuntime(h.configuration);
    const chat = await runtime.create({ folder: await h.folder("work") });
    await runtime.start(chat.id, "tool:bigpatch:{}").completion;
    const result = everything(runtime, chat.id).find((item) => item.toolName === "bigpatch")!;
    const details = result.details as { patch: string; note: string };
    assert.equal(result.clipped, true);
    assert.equal(details.patch.length, 256 * 1024, "a patch keeps up to 256 KB");
    assert.equal(details.note, "y".repeat(100));
    await runtime.start(chat.id, "tool:huge:{}").completion;
    const huge = everything(runtime, chat.id).find((item) => item.toolName === "huge")!;
    // Too large to send even when cut: its details go and its text keeps only its start.
    assert.equal(huge.clipped, true);
    assert.equal(huge.details, undefined);
    const text = huge.parts[0]!;
    assert(text.type === "text" && text.text.length === 16 * 1024 && text.size === 200000);
    assert(JSON.stringify(huge).length < 768 * 1024);
    // Small results are untouched.
    const user = everything(runtime, chat.id).find((item) => item.role === "user")!;
    assert.equal(user.clipped, undefined);
    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});

test("what is in flight stays inside a frame however much of it there is", () => {
  const big = (key: string): Item => ({
    key,
    role: "toolResult",
    parts: [{ type: "text", text: "x".repeat(150 * 1024) }],
    details: { blob: "z".repeat(200 * 1024) },
  });
  const small: Item[] = [{ key: "a", role: "assistant", parts: [{ type: "text", text: "hi" }] }];
  assert.equal(boundTail(small), small);
  const shrunk = boundTail([big("1"), big("2"), big("3")]);
  assert(JSON.stringify(shrunk).length < 768 * 1024);
  for (const item of shrunk) {
    assert.equal(item.clipped, true);
    assert.equal(item.details, undefined);
    const part = item.parts[0]!;
    assert(part.type === "text" && part.size === 150 * 1024 && part.text.length === 16 * 1024);
  }
});
