import assert from "node:assert/strict";
import test from "node:test";
import { SessionRuntime } from "../src/runtime/session-runtime.js";
import type { Item, LiveOp } from "../src/protocol.js";
import { applyOp } from "../src/stream-ops.js";
import type { Json } from "../src/stream-ops.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";

const PICTURES = `
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export default function (pi) {
  pi.registerTool({
    name: "pictures",
    label: "Pictures",
    description: "Returns an image and an SVG",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [
        { type: "text", text: "two pictures" },
        { type: "image", data: PNG, mimeType: "image/png" },
        { type: "image", data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString("base64"), mimeType: "image/svg+xml" },
      ], details: {} };
    },
  });
}
`;

test("a live view turns a growing answer into appends and a commit keeps the item's key", async () => {
  const h = await testHome("pispark-live-");
  try {
    await h.persona("default", { name: "Default" }, { "instructions/test.md": "test only" });
    const runtime = new SessionRuntime(h.configuration);
    const chat = await runtime.create({ folder: await h.folder("work") });
    const { view, events } = runtime.observeLive(chat.id);
    const state = { doc: (view.snapshot() as { doc: unknown }).doc as { [key: string]: Json }, head: (view.snapshot() as { head: string | null }).head };
    const committed: Item[] = [];
    const ops: LiveOp[] = [];
    const pump = () => {
      const batch = view.next();
      if (batch?.type !== "ops") return;
      for (const op of batch.ops) {
        ops.push(op);
        if (op.op === "commit") {
          assert.equal(op.after, state.head);
          state.head = op.head;
          committed.push(...(op.items ?? []));
        } else applyOp(state.doc, op);
      }
    };
    const run = runtime.start(chat.id, "stream-me");
    await eventually(() => h.provider.requests.length === 1);
    pump();
    const tailKey = (state.doc.tail as { key: string }[]).find((item) => (item as unknown as Item).role === "assistant")?.key;
    assert(tailKey, "the answer in flight is in the tail with a key");
    const lengths: number[] = [];
    for (let n = 0; n < 5; n++) {
      h.provider.requests[0]!.pushText("word ".repeat(200));
      pump();
      lengths.push(ops.length);
    }
    // After the first sight of the message, each tick only appended what was new.
    const appends = ops.filter((op) => op.op === "append");
    assert(appends.length >= 5);
    assert(appends.every((op) => op.op === "append" && op.text.length <= 1000 + 5), "appends carry only new text");
    h.provider.requests[0]!.release();
    await run.completion;
    await eventually(() => {
      pump();
      return committed.some((item) => item.role === "assistant");
    });
    const assistant = committed.find((item) => item.role === "assistant")!;
    assert.equal(assistant.key, tailKey, "the key survives the commit, so the UI does not remount");
    assert(assistant.id, "and the item now has Pi's entry id");
    pump();
    assert.deepEqual(state.doc.tail, [], "nothing is left in flight");
    assert.equal(state.head, runtime.items(chat.id, { limit: 1 }).head);
    events.close();
    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});

test("a new connection starts from what is in flight and the head, not from history", async () => {
  const h = await testHome("pispark-live-");
  try {
    await h.persona("default", { name: "Default" }, { "instructions/test.md": "test only" });
    h.provider.automatic = true;
    const runtime = new SessionRuntime(h.configuration);
    const chat = await runtime.create({ folder: await h.folder("work") });
    for (const word of ["one", "two", "three"]) await runtime.start(chat.id, word).completion;
    const { view, events } = runtime.observeLive(chat.id);
    const snapshot = view.snapshot();
    assert(snapshot.type === "snapshot");
    assert.deepEqual(snapshot.doc.tail, [], "an idle chat has nothing in flight");
    assert.equal(snapshot.head, runtime.items(chat.id, {}).head);
    assert(JSON.stringify(snapshot).length < 4000, "and the snapshot stays small however long the chat is");
    assert.equal(view.next(), undefined, "an unchanged chat produces no batch");
    events.close();
    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});

test("images are described in items and served as bytes with a sandboxing policy", async () => {
  const h = await testHome("pispark-live-");
  try {
    await h.persona("default", { name: "Default" }, { "extensions/pictures.mjs": PICTURES });
    h.provider.automatic = true;
    const runtime = new SessionRuntime(h.configuration);
    const chat = await runtime.create({ folder: await h.folder("work") });
    await runtime.start(chat.id, "tool:pictures:{}").completion;
    const result = runtime.items(chat.id, {}).items.find((item) => item.role === "toolResult")!;
    assert.deepEqual(
      result.parts.map((part) => part.type === "image" ? [part.type, part.mimeType] : [part.type]),
      [["text"], ["image", "image/png"], ["image", "image/svg+xml"]],
    );
    assert(!JSON.stringify(result).includes("iVBOR"), "no base64 travels in the item");
    const png = runtime.image(chat.id, result.id!, 1);
    assert.equal(png.mimeType, "image/png");
    assert.deepEqual([...png.data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal(runtime.image(chat.id, result.id!, 2).mimeType, "image/svg+xml");
    assert.throws(() => runtime.image(chat.id, result.id!, 0), /not-found/);
    assert.throws(() => runtime.image(chat.id, "missing", 1), /not-found/);
    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});

const PROGRESS = `
export default function (pi) {
  pi.registerTool({
    name: "steps", label: "Steps", description: "Reports progress", parameters: { type: "object", properties: {} },
    async execute(_id, _params, _signal, onUpdate) {
      let output = "";
      for (let i = 1; i <= 3; i++) {
        output += "step " + i + "\\n";
        onUpdate?.({ content: [{ type: "text", text: output }], details: { done: i } });
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return { content: [{ type: "text", text: output + "finished" }], details: {} };
    },
  });
}
`;

test("a running tool's progress streams in the live document and leaves when the call ends", async () => {
  const h = await testHome("pispark-live-");
  try {
    await h.persona("default", { name: "Default" }, { "extensions/steps.mjs": PROGRESS });
    h.provider.automatic = true;
    const runtime = new SessionRuntime(h.configuration);
    const chat = await runtime.create({ folder: await h.folder("work") });
    const { view, events } = runtime.observeLive(chat.id);
    const doc = (view.snapshot() as unknown as { doc: { [key: string]: Json } }).doc;
    const seen: string[] = [];
    const run = runtime.start(chat.id, "tool:steps:{}");
    let done = false;
    void run.completion.then(() => (done = true));
    while (!done) {
      const batch = view.next();
      if (batch?.type === "ops") for (const op of batch.ops) if (op.op !== "commit") applyOp(doc, op);
      const progress = Object.values(doc.progress as Record<string, { output: string; details?: Json }>);
      if (progress[0] && !seen.includes(progress[0].output)) seen.push(progress[0].output);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Each step was visible while the tool ran, with its details.
    assert.deepEqual(seen.slice(-3), ["step 1\n", "step 1\nstep 2\n", "step 1\nstep 2\nstep 3\n"]);
    const batch = view.next();
    if (batch?.type === "ops") for (const op of batch.ops) if (op.op !== "commit") applyOp(doc, op);
    assert.deepEqual(doc.progress, {}, "nothing is left once the call ended");
    events.close();
    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});
