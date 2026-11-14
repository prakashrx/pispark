import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { RuntimeError } from "../src/core/runtime/errors.js";
import { REPORT_TOOL, SESSION_TOOL } from "../src/core/runtime/session-tool.js";
import { STATUS_ENTRY, WOKEN_ENTRY } from "../src/contract/wake-protocol.js";
import type { LocalRequest } from "./fixtures/local-provider.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";

const call = (args: object) => `tool:${SESSION_TOOL}:${JSON.stringify(args)}`;
const toolsOf = (request: LocalRequest) =>
  request.context.messages.flatMap((message) => (message.role === "system" ? (message.toolsAdded ?? []).map((tool) => tool.name) : []));
const text = (item: { parts: { type: string; text?: string }[] }) => item.parts.map((part) => part.text ?? "").join("");

async function fixture() {
  const h = await testHome("pispark-children-");
  h.provider.automatic = true;
  const runtime = new SessionRuntime({ ...h.configuration, wakeTickMs: 0 });
  const folder = await h.folder("work");
  return {
    ...h,
    runtime,
    folder,
    children: (id: string) => runtime.list().filter((session) => session.parent === id),
    cleanup: async () => {
      await runtime.shutdown();
      await h.remove();
    },
  };
}

test("a session starts a child; the child's answer comes back to the parent as a turn", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(parent.id, call({ action: "start", prompt: "research zustand", title: "Zustand research" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    assert.equal(child.title, "Zustand research");
    assert.equal(child.folder, parent.folder);

    // The child's first message says it came from the parent; the child cannot start sessions.
    await eventually(() => f.runtime.list().find((s) => s.id === child.id)?.status === "idle");
    const childItems = f.runtime.items(child.id, {}).items;
    const sent = childItems.find((item) => item.customType === WOKEN_ENTRY)!;
    const parentTitle = f.runtime.list().find((s) => s.id === parent.id)!.title;
    assert.deepEqual((sent.details as { source: unknown }).source, { kind: "session", id: parent.id, label: parentTitle });
    assert.ok(childItems.some((item) => item.role === "assistant" && text(item) === "local:research zustand"));
    const childRequest = f.provider.requests.find((request) => JSON.stringify(request.context.messages).includes("research zustand") && !toolsOf(request).includes(SESSION_TOOL));
    assert.ok(childRequest, "the child's model call has no session tool");

    // Its answer wakes the parent as soon as the parent is free.
    await eventually(() => f.runtime.items(parent.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
    const parentItems = f.runtime.items(parent.id, {}).items;
    const report = parentItems.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.deepEqual((parentItems[report]!.details as { source: unknown }).source, { kind: "session", id: child.id, label: "Zustand research · finished" });
    assert.match(text(parentItems[report + 1]!), /^The session "Zustand research" you started finished:\n\nlocal:research zustand$/);
  } finally {
    await f.cleanup();
  }
});

test("the tool lists, sends to, reads and stops its own children only; a child cannot start sessions", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(parent.id, call({ action: "start", prompt: "first", title: "Helper", report: "none" })).completion;
    const [child] = f.children(parent.id);
    await eventually(() => f.runtime.list().find((s) => s.id === child!.id)?.status === "idle");
    const answer = async (id: string, args: object) => {
      await f.runtime.start(id, call(args)).completion;
      const items = f.runtime.items(id, {}).items;
      return text(items.filter((item) => item.role === "toolResult").at(-1)!);
    };
    assert.match(await answer(parent.id, { action: "list" }), new RegExp(`^${child!.id}: Helper \\(finished\\)$`));
    assert.equal(await answer(parent.id, { action: "read", id: child!.id }), "local:first");
    assert.equal(await answer(parent.id, { action: "send", id: child!.id, text: "second" }), "Sent.");
    await eventually(() => f.runtime.items(child!.id, {}).items.some((item) => text(item) === "local:second"));
    assert.equal(await answer(parent.id, { action: "stop", id: child!.id }), "It is not working.");
    // report "none" keeps the answers out of the parent.
    assert.ok(!f.runtime.items(parent.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
    // Another session's children are not this one's.
    const other = await f.runtime.create({ folder: f.folder });
    assert.match(await answer(other.id, { action: "read", id: child!.id }), /did not start a session with that id/);
    // In the child, the request is refused even if something sends it.
    assert.match(await answer(child!.id, { action: "list" }), /Tool pispark_session not found|not found|not available/i);
  } finally {
    await f.cleanup();
  }
});

test("archiving a parent takes its children along; restore brings them back; delete removes them", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(parent.id, call({ action: "start", prompt: "work", title: "Child", report: "none" })).completion;
    const [child] = f.children(parent.id);
    await eventually(() => f.runtime.list().find((s) => s.id === child!.id)?.status === "idle");
    await f.runtime.archive(parent.id);
    assert.deepEqual(
      f.runtime.archived().map((s) => s.id).sort(),
      [parent.id, child!.id].sort(),
    );
    f.runtime.restore(parent.id);
    assert.deepEqual(f.children(parent.id).map((s) => s.id), [child!.id]);
    await f.runtime.archive(parent.id);
    f.runtime.delete(parent.id);
    assert.equal(existsSync(join(f.home, "chats", child!.id)), false);
    assert.throws(() => f.runtime.restore(child!.id), (e) => e instanceof RuntimeError && e.code === "not-found");
  } finally {
    await f.cleanup();
  }
});

test("status mode: a line in the parent without a turn; the child can raise something, which wakes it", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(parent.id, call({ action: "start", prompt: "all green", title: "Quiet", report: "status" })).completion;
    const [quiet] = f.children(parent.id);
    await eventually(() => f.runtime.items(parent.id, {}).items.some((item) => item.customType === STATUS_ENTRY));
    const line = f.runtime.items(parent.id, {}).items.find((item) => item.customType === STATUS_ENTRY)!;
    assert.deepEqual(line.details, { session: quiet!.id, title: "Quiet", how: "finished" });
    // No turn: nothing woke the parent's agent.
    assert.ok(!f.runtime.items(parent.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
    const childRequest = f.provider.requests.find((request) => JSON.stringify(request.context.messages).includes("all green") && !toolsOf(request).includes(SESSION_TOOL));
    assert.ok(toolsOf(childRequest!).includes(REPORT_TOOL), "a child in status mode can raise things");

    // The child raises something: its text wakes the parent.
    const raise = `tool:${REPORT_TOOL}:${JSON.stringify({ text: "3 tests broke" })}`;
    await f.runtime.start(parent.id, call({ action: "start", prompt: raise, title: "Loud", report: "status" })).completion;
    await eventually(() =>
      f.runtime.items(parent.id, {}).items.some((item) => item.customType === WOKEN_ENTRY && (item.details as { source: { label: string } }).source.label === "Loud · raised"),
    );
    const items = f.runtime.items(parent.id, {}).items;
    const woken = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.equal(text(items[woken + 1]!), 'The session "Loud" you started raises this:\n\n3 tests broke');
    // A session nobody started cannot raise anything.
    const lone = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(lone.id, raise).completion;
    const result = f.runtime.items(lone.id, {}).items.filter((item) => item.role === "toolResult").at(-1);
    assert.match(text(result!), /not found|not available|Only a session/i);
  } finally {
    await f.cleanup();
  }
});

const ORCHESTRATE = `
export default function (pi) {
  pi.events.on("pispark:child-ended", (event) => {
    if (event.title === "Skip me") event.reply({ action: "skip" });
    else if (event.title === "Reword") event.reply({ action: "send", text: "Reworded: " + JSON.stringify(event.data) });
  });
  pi.registerTool({
    name: "submit",
    label: "Submit",
    description: "Hands the result over.",
    parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
    async execute(_id, params) {
      pi.events.emit("pispark:result", { data: { value: params.value } });
      return { content: [{ type: "text", text: "submitted" }], details: undefined };
    },
  });
}
`;

test("the parent's extensions see a child's end first: they may take it or reword it, with the child's data", async () => {
  const f = await fixture();
  try {
    await f.persona("orchestrator", { name: "Orchestrator" }, { "extensions/orchestrate.mjs": ORCHESTRATE });
    const parent = await f.runtime.create({ folder: f.folder, persona: "orchestrator" });
    const submit = `tool:submit:${JSON.stringify({ value: "42" })}`;
    await f.runtime.start(parent.id, call({ action: "start", prompt: submit, title: "Reword" })).completion;
    await eventually(() => f.runtime.items(parent.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
    const items = f.runtime.items(parent.id, {}).items;
    const woken = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.equal(text(items[woken + 1]!), 'Reworded: {"value":"42"}');

    // Taken by the extension: nothing wakes the agent; the record says so.
    await f.runtime.start(parent.id, call({ action: "start", prompt: "quiet work", title: "Skip me" })).completion;
    const skipped = f.children(parent.id).find((child) => child.title === "Skip me")!;
    await eventually(() => {
      const file = JSON.parse(readFileSync(join(f.home, "chats", parent.id, "wakes.json"), "utf8"));
      return file.records[skipped.id]?.[0]?.outcome === "handled";
    });
    assert.equal(f.runtime.items(parent.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY).length, 1);
  } finally {
    await f.cleanup();
  }
});
