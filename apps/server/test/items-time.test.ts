import assert from "node:assert/strict";
import test from "node:test";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { testHome } from "./fixtures/home.js";

test("items carry when Pi recorded them, so a turn's time can be shown", async () => {
  const h = await testHome("pispark-time-");
  try {
    await h.agent("default", { name: "Default" });
    h.provider.automatic = true;
    const runtime = new SessionRuntime(h.configuration);
    const session = await runtime.create({ folder: await h.folder("work") });
    const before = Date.now();
    await runtime.start(session.id, "tool:read:{\"path\":\"missing.txt\"}").completion;
    const after = Date.now();
    const items = runtime.items(session.id, {}).items;
    const user = items.find((item) => item.role === "user")!;
    const replies = items.filter((item) => item.role === "assistant");
    const result = items.find((item) => item.role === "toolResult")!;
    assert(user.at! >= before - 1000 && user.at! <= after, "the turn starts when Pi recorded your message");
    assert(replies.length >= 2);
    for (const reply of replies) assert(reply.at! >= user.at!, "each response comes after the message it answers");
    assert(result.at! >= user.at! && result.at! <= after);
    // A response's time Pi measured is whole milliseconds, when it measured one.
    for (const item of [...replies, result]) if (item.durationMs !== undefined) assert(Number.isInteger(item.durationMs) && item.durationMs >= 0);
    await runtime.shutdown();
  } finally {
    await h.remove();
  }
});
