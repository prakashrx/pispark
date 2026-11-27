import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { RuntimeError } from "../src/core/runtime/errors.js";
import { REPORT_TOOL, SESSION_TOOL } from "../src/core/runtime/session-tool.js";
import { PROCESS_TOOL } from "../src/core/runtime/process-tool.js";
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

const cardBody = (marker: { details?: unknown }, message: Parameters<typeof text>[0]) => {
  const { card } = marker.details as { card: { title: string; how: string; start: number } };
  return { ...card, body: text(message).slice(card.start) };
};
test("a session starts a child; the child's answer comes back to the parent as a turn", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(parent.id, call({ action: "start", prompt: "research zustand", title: "Zustand research" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    assert.equal(child.title, "Zustand research");
    assert.equal(child.folder, parent.folder);
    // The tool call names the session it started in its details, for clients.
    const started = f.runtime.items(parent.id, {}).items.find((item) => item.role === "toolResult");
    assert.deepEqual(started?.details, { id: child.id });

    // The child's first message says it came from the parent; the child cannot start sessions.
    await eventually(() => f.runtime.list().find((s) => s.id === child.id)?.status === "idle");
    const childItems = f.runtime.items(child.id, {}).items;
    const sent = childItems.find((item) => item.customType === WOKEN_ENTRY)!;
    const parentTitle = f.runtime.list().find((s) => s.id === parent.id)!.title;
    assert.deepEqual((sent.details as { source: unknown }).source, { kind: "session", id: parent.id, label: parentTitle });
    assert.ok(childItems.some((item) => item.role === "assistant" && text(item) === "local:research zustand"));
    const childRequest = f.provider.requests.find((request) => JSON.stringify(request.context.messages).includes("research zustand") && toolsOf(request).includes(SESSION_TOOL));
    assert.ok(childRequest, "the child has the session tool for self-inspection");

    // Its answer wakes the parent as soon as the parent is free.
    await eventually(() => f.runtime.items(parent.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
    const parentItems = f.runtime.items(parent.id, {}).items;
    const report = parentItems.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.deepEqual((parentItems[report]!.details as { source: unknown }).source, { kind: "session", id: child.id, label: "Zustand research · finished" });
    assert.match(text(parentItems[report + 1]!), /^The session "Zustand research" you started finished:\n\nlocal:research zustand$/);
    // Its card: whose it is, how it ended, and the report after the line the agent needs.
    const heading = 'The session "Zustand research" you started finished:\n\n';
    assert.deepEqual(cardBody(parentItems[report]!, parentItems[report + 1]!), { title: "Zustand research", how: "finished", start: heading.length, body: "local:research zustand" });
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
    assert.match(await answer(child!.id, { action: "list" }), /Child sessions cannot manage other sessions/i);
  } finally {
    await f.cleanup();
  }
});

test("notice names the exact child run, omits its answer, and keeps a later failure distinct after restart", async () => {
  const f = await fixture();
  let restarted: SessionRuntime | undefined;
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    const tool = async (args: object, runtime = f.runtime, id = parent.id) => {
      await runtime.start(id, call(args)).completion;
      return text(runtime.items(id, {}).items.filter((item) => item.role === "toolResult").at(-1)!);
    };
    const notices = () => {
      const items = f.runtime.items(parent.id, {}).items;
      return items.flatMap((item, i) => item.customType === WOKEN_ENTRY ? [text(items[i + 1]!)] : []);
    };
    const idleWithNotices = (count: number) => eventually(() => {
      const seen = notices();
      return seen.length === count && seen.every((notice) => !!notice) && f.runtime.list().find((s) => s.id === parent.id)?.status === "idle";
    });
    await tool({ action: "start", prompt: "first exact finding", title: "Reporter", report: "notice" });
    const [child] = f.children(parent.id);
    assert.ok(child);
    await idleWithNotices(1);
    const first = notices()[0]!;
    const firstId = first.match(/finished \(run_id: ([^)]+)\)/)?.[1];
    assert.ok(firstId);
    assert.doesNotMatch(first, /first exact finding|local:/);
    assert.equal(await tool({ action: "send", id: child.id, text: "provider-error" }), "Sent.");
    await idleWithNotices(2);
    const second = notices()[1]!;
    const secondId = second.match(/failed \(run_id: ([^)]+)\)/)?.[1];
    assert.ok(secondId);
    assert.notEqual(firstId, secondId);
    assert.doesNotMatch(second, /first exact finding|local:/);

    await f.runtime.shutdown();
    restarted = new SessionRuntime({ ...f.configuration, wakeTickMs: 0 });
    await restarted.ensure(parent.id);
    assert.equal(await tool({ action: "read", id: child.id, run_id: firstId }, restarted), `Run ${firstId} finished.\n\nlocal:first exact finding`);
    assert.match(await tool({ action: "read", id: child.id, run_id: secondId }, restarted), /^Run \S+ failed(?: \([\w-]+\))?\.\n\nNo answer for this run\.$/);
    assert.match(await tool({ action: "read", id: child.id, run_id: "unknown" }, restarted), /No such completed run/);
    const other = await restarted.create({ folder: f.folder });
    assert.match(await tool({ action: "read", id: child.id, run_id: firstId }, restarted, other.id), /did not start a session/);
  } finally {
    await restarted?.shutdown();
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
    assert.equal(existsSync(join(f.home, "sessions", child!.id)), false);
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
    assert.deepEqual(line.details, { session: quiet!.id, title: "Quiet", how: "finished", ok: true });
    // No turn: nothing woke the parent's agent.
    assert.ok(!f.runtime.items(parent.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
    const childRequest = f.provider.requests.find((request) => JSON.stringify(request.context.messages).includes("all green") && toolsOf(request).includes(REPORT_TOOL));
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
    assert.equal(cardBody(items[woken]!, items[woken + 1]!).body, "3 tests broke");
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
    await f.agent("orchestrator", { name: "Orchestrator" }, { "extensions/orchestrate.mjs": ORCHESTRATE });
    const parent = await f.runtime.create({ folder: f.folder, agent: "orchestrator" });
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
      const file = JSON.parse(readFileSync(join(f.home, "sessions", parent.id, "wakes.json"), "utf8"));
      return file.records[skipped.id]?.[0]?.outcome === "handled";
    });
    assert.equal(f.runtime.items(parent.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY).length, 1);
  } finally {
    await f.cleanup();
  }
});

test("a manual fork inherits history and runs independently from its source", async () => {
  const f = await fixture();
  try {
    const source = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(source.id, "shared history").completion;
    const fork = await f.runtime.fork(source.id);
    await f.runtime.open(fork);
    assert.equal(f.runtime.session(fork).forkOf, source.id);
    assert.deepEqual(f.runtime.items(fork, {}).items.map(text), f.runtime.items(source.id, {}).items.map(text));
    await f.runtime.archive(source.id);
    await f.runtime.start(fork, "only in the fork").completion;
    assert.equal(f.runtime.items(fork, {}).items.findLast((item) => item.role === "assistant")?.parts[0]?.type, "text");
    f.runtime.restore(source.id);
    await f.runtime.open(source.id);
    const items = f.runtime.items(source.id, {}).items;
    assert.ok(!items.some((item) => item.customType === WOKEN_ENTRY || text(item).includes("only in the fork")));
  } finally {
    await f.cleanup();
  }
});

// ---- One ask, one answer: the parent hears when the child is at rest, not at every run's end ----

const processCall = (args: object) => `tool:${PROCESS_TOOL}:${JSON.stringify(args)}`;
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** What a parent was sent by one of its children: each report's body. */
function reportsFrom(f: Awaited<ReturnType<typeof fixture>>, parentId: string, childId: string): string[] {
  const items = f.runtime.items(parentId, {}).items;
  return items.flatMap((item, i) => (item.customType === WOKEN_ENTRY && (item.details as { source: { id: string } }).source.id === childId ? [text(items[i + 1]!)] : []));
}

test("a child answers once, when at rest: a process it still waits for holds the answer, and what it said before is in it", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    // The child's first turn starts a process that outlives the turn.
    const slow = `node -e "setTimeout(() => console.log('tests passed'), 3000)"`;
    await f.runtime.start(parent.id, call({ action: "start", prompt: processCall({ action: "start", command: slow, title: "tests" }), title: "Builder" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await eventually(() => f.runtime.list().find((s) => s.id === child.id)?.status === "idle");
    assert.equal(f.runtime.listProcesses(child.id)[0]?.state, "running");
    // Its run ended, but it is not at rest: nothing reaches the parent.
    await pause(300);
    assert.deepEqual(reportsFrom(f, parent.id, child.id), []);

    // The process ends and wakes the child. That run leaves nothing to wait for: one answer.
    await eventually(() => reportsFrom(f, parent.id, child.id).length === 1, 20_000);
    const [body] = reportsFrom(f, parent.id, child.id);
    assert.match(body!, /^The session "Builder" you started finished:\n\n/);
    // Everything it said since it was asked: its first turn's closing words, then its second's.
    const first = body!.indexOf("local:[");
    const second = body!.indexOf('local:The process "tests" exited 0');
    assert.ok(first > 0 && second > first, body);
    await pause(300);
    assert.equal(reportsFrom(f, parent.id, child.id).length, 1);
  } finally {
    await f.cleanup();
  }
});

test("a process end the child has already seen is not told again: one run, one answer", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    // The child waits for the process's output in its turn, and is shown that it has ended.
    const quick = `node -e "console.log('done')"`;
    await f.runtime.start(parent.id, call({ action: "start", prompt: processCall({ action: "start", command: quick, title: "quick", wait_for: "done", timeout_seconds: 20 }), title: "Checker" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await eventually(() => reportsFrom(f, parent.id, child.id).length === 1, 20_000);
    await pause(400);
    // The end was not sent to the child as a second message, so the child ran once.
    const childItems = f.runtime.items(child.id, {}).items;
    assert.equal(childItems.filter((item) => item.customType === WOKEN_ENTRY && (item.details as { source: { kind: string } }).source.kind === "process").length, 0);
    assert.equal(childItems.filter((item) => item.role === "assistant" && text(item).startsWith("local:")).length, 1);
    assert.equal(reportsFrom(f, parent.id, child.id).length, 1);
  } finally {
    await f.cleanup();
  }
});

test("a run its parent did not ask for tells the parent nothing; a new message from the parent is a new ask", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(parent.id, call({ action: "start", prompt: "look into it", title: "Looker" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await eventually(() => reportsFrom(f, parent.id, child.id).length === 1);
    await eventually(() => f.runtime.list().find((s) => s.id === parent.id)?.status === "idle");

    // The person talks to the child: its answer is theirs, in the child's conversation.
    await f.runtime.start(child.id, "and one more thing").completion;
    await pause(300);
    assert.equal(reportsFrom(f, parent.id, child.id).length, 1);

    // The parent sends again: one more answer, holding only what was said since.
    await f.runtime.start(parent.id, call({ action: "send", id: child.id, text: "second question" })).completion;
    await eventually(() => reportsFrom(f, parent.id, child.id).length === 2);
    assert.match(reportsFrom(f, parent.id, child.id)[1]!, /finished:\n\nlocal:second question$/);
  } finally {
    await f.cleanup();
  }
});

test("the real case in small: several processes, some already seen, one answer to the parent", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    // Two checks the child watches to their end in its turn, and one that ends after the turn.
    const seen = (title: string) => ({ name: PROCESS_TOOL, args: { action: "start", command: `node -e "console.log('done')"`, title, wait_for: "done", timeout_seconds: 20 } });
    const late = { name: PROCESS_TOOL, args: { action: "start", command: `node -e "setTimeout(() => console.log('late'), 3000)"`, title: "late check" } };
    const prompt = `tools:${JSON.stringify([seen("typecheck"), seen("unit tests"), late])}`;
    await f.runtime.start(parent.id, call({ action: "start", prompt, title: "Implementer" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await eventually(() => reportsFrom(f, parent.id, child.id).length === 1, 20_000);
    await pause(400);
    // Only the end it had not seen was sent to it; its parent heard once.
    const woken = f.runtime.items(child.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY).map((item) => (item.details as { source: { kind: string; label: string } }).source);
    assert.deepEqual(woken.filter((source) => source.kind === "process").map((source) => source.label), ["late check · exited 0"]);
    assert.equal(reportsFrom(f, parent.id, child.id).length, 1);
  } finally {
    await f.cleanup();
  }
});

