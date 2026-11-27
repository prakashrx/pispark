import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { RuntimeError } from "../src/core/runtime/errors.js";
import { toolOf, VERBS } from "../src/contract/verbs.js";
import { STATUS_ENTRY, WOKEN_ENTRY } from "../src/contract/wake-protocol.js";
import type { LocalRequest } from "./fixtures/local-provider.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";
import { say, steps } from "./fixtures/verbs.js";

const toolsOf = (request: LocalRequest) =>
  request.context.messages.flatMap((message) => (message.role === "system" ? (message.toolsAdded ?? []).map((tool) => tool.name) : []));
const text = (item: { parts: { type: string; text?: string }[] }) => item.parts.map((part) => part.text ?? "").join("");
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function fixture() {
  const h = await testHome("pispark-children-");
  h.provider.automatic = true;
  const runtime = new SessionRuntime({ ...h.configuration, wakeTickMs: 0 });
  const folder = await h.folder("work");
  const idle = (id: string) => eventually(() => runtime.list().find((s) => s.id === id)?.status === "idle");
  return {
    ...h,
    runtime,
    folder,
    idle,
    children: (id: string) => runtime.list().filter((session) => session.parent === id),
    /** One verb said by a session's agent, and what PiSpark answered. */
    answer: async (id: string, prompt: string) => {
      await idle(id);
      await runtime.start(id, prompt).completion;
      return text(runtime.items(id, {}).items.filter((item) => item.role === "toolResult").at(-1)!);
    },
    /** What a parent was sent by one of its children: each message's text, by how its card reads ("finished", "raised"). */
    heard: (parentId: string, childId: string, how = "finished") => {
      const items = runtime.items(parentId, {}).items;
      return items.flatMap((item, i) => {
        const details = item.customType === WOKEN_ENTRY ? (item.details as { source: { id: string }; card?: { how: string } }) : undefined;
        return details?.source.id === childId && details.card?.how === how ? [text(items[i + 1]!)] : [];
      });
    },
    metadata: (id: string) => JSON.parse(readFileSync(join(h.home, "sessions", id, "session.json"), "utf8")) as { ask?: unknown; raise?: string; note?: string },
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
    await f.runtime.start(parent.id, say("start_session", { brief: "research zustand", title: "Zustand research" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    assert.equal(child.title, "Zustand research");
    assert.equal(child.folder, parent.folder);
    // The tool call names the session it started: by its handle for the agent, by its id in the details, for clients.
    const started = f.runtime.items(parent.id, {}).items.find((item) => item.role === "toolResult")!;
    assert.deepEqual(started.details, { id: child.id });
    assert.match(text(started), /^Started "Zustand research" \(session-1\)\. It works on its own;/);

    // The child's first message says it came from the parent.
    await f.idle(child.id);
    const childItems = f.runtime.items(child.id, {}).items;
    const sent = childItems.find((item) => item.customType === WOKEN_ENTRY)!;
    const parentTitle = f.runtime.list().find((s) => s.id === parent.id)!.title;
    assert.deepEqual((sent.details as { source: unknown }).source, { kind: "session", id: parent.id, label: parentTitle });
    assert.ok(childItems.some((item) => item.role === "assistant" && text(item) === "local:research zustand"));

    // A child is a worker: it has six of the ten verbs, and is told who asked, how it talks and that it starts no sessions.
    const told = (request: LocalRequest) => JSON.stringify(request.context.messages);
    const childRequest = f.provider.requests.find((request) => /started this one and gave it its first message\. What you say when you finish is your answer to it/.test(told(request)))!;
    assert.ok(childRequest, "the child is told who asked and how it talks");
    assert.match(told(childRequest), /You cannot start sessions\./);
    assert.deepEqual(
      VERBS.filter((verb) => toolsOf(childRequest).includes(toolOf(verb))),
      ["start_process", "wait", "look", "stop", "raise", "note"],
    );
    const parentRequest = f.provider.requests.find((request) => toolsOf(request).includes(toolOf("start_session")))!;
    assert.deepEqual(VERBS.filter((verb) => toolsOf(parentRequest).includes(toolOf(verb))), [...VERBS]);

    // Its answer wakes the parent as soon as the parent is free, naming the child by its handle.
    await eventually(() => f.runtime.items(parent.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
    const parentItems = f.runtime.items(parent.id, {}).items;
    const report = parentItems.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.deepEqual((parentItems[report]!.details as { source: unknown }).source, { kind: "session", id: child.id, label: "Zustand research · finished" });
    const heading = 'The session "Zustand research" (session-1) you started finished:\n\n';
    assert.equal(text(parentItems[report + 1]!), `${heading}local:research zustand`);
    // Its card: whose it is, how it ended, and the answer after the line the agent needs.
    assert.deepEqual(cardBody(parentItems[report]!, parentItems[report + 1]!), { title: "Zustand research", how: "finished", start: heading.length, body: "local:research zustand" });
  } finally {
    await f.cleanup();
  }
});

test("look, send and stop find a child by its handle; a session's handles are its own; a child cannot start sessions", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(parent.id, say("start_session", { brief: "first", title: "Helper" })).completion;
    const [child] = f.children(parent.id);
    await eventually(() => f.heard(parent.id, child!.id).length === 1);

    assert.equal(await f.answer(parent.id, say("look")), 'session-1: "Helper" — at rest');
    assert.equal(await f.answer(parent.id, say("look", { id: "session-1" })), '"Helper" — at rest\nIt last said:\nlocal:first');
    // A message to a child at rest is a new ask, with its own answer.
    assert.equal(await f.answer(parent.id, say("send", { id: "session-1", text: "second" })), "Sent. Its answer arrives here as a message when it is done.");
    await eventually(() => f.heard(parent.id, child!.id).length === 2);
    assert.match(f.heard(parent.id, child!.id)[1]!, /finished:\n\nlocal:second$/);
    assert.equal(await f.answer(parent.id, say("stop", { id: "session-1" })), "It is not working.");
    assert.match(await f.answer(parent.id, say("send", { id: "session-1", raise_on: "error" })), /A session is sent text/);

    // A handle means something only to the session that started the thing.
    const other = await f.runtime.create({ folder: f.folder });
    assert.match(await f.answer(other.id, say("look", { id: "session-1" })), /started nothing with that id/);
    assert.equal(await f.answer(other.id, say("look")), "This session has not started anything.");
    // A child has no tool to start a session with, and PiSpark refuses whatever asks for one from inside it.
    assert.match(await f.answer(child!.id, say("start_session", { brief: "more help" })), /not found|cannot start sessions/i);
  } finally {
    await f.cleanup();
  }
});

test("a child notes (a line, no turn) and raises (its parent is woken); it waits for the answer, then answers once", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    const brief = steps(["note", { text: "half way" }], ["raise", { text: "Postgres or SQLite?" }]);
    await f.runtime.start(parent.id, say("start_session", { brief, title: "Builder" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);

    // The raise wakes the parent, with what to do about it.
    await eventually(() => f.heard(parent.id, child.id, "raised").length === 1);
    assert.equal(
      f.heard(parent.id, child.id, "raised")[0],
      'The session "Builder" (session-1) you started raises this, and waits for your answer (pispark_send):\n\nPostgres or SQLite?',
    );
    // The note is a line in the parent's conversation: nothing woke its agent for it.
    const line = f.runtime.items(parent.id, {}).items.find((item) => item.customType === STATUS_ENTRY)!;
    assert.deepEqual(line.details, { session: child.id, title: "Builder", how: "notes: half way" });
    assert.equal(text(line), '"Builder" (session-1) notes: half way');
    assert.equal(f.runtime.items(parent.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY).length, 1);

    // Its run ended, but it is owed an answer: it is waiting, not at rest, and has not answered.
    await f.idle(child.id);
    await pause(300);
    assert.deepEqual(f.heard(parent.id, child.id), []);
    assert.equal(await f.answer(parent.id, say("look", { id: "session-1" })).then((seen) => seen.split("\n").slice(0, 3).join("\n")), '"Builder" — waiting for your answer\nIt raised: Postgres or SQLite?\nIts last note: half way');

    // The parent answers. The child carries on, comes to rest, and answers once, with everything it said.
    assert.match(await f.answer(parent.id, say("send", { id: "session-1", text: "SQLite" })), /^Sent\./);
    await eventually(() => f.heard(parent.id, child.id).length === 1);
    const answer = f.heard(parent.id, child.id)[0]!;
    assert.ok(answer.indexOf("Raised with") > 0 && answer.indexOf("local:SQLite") > answer.indexOf("Raised with"), answer);
    assert.equal(f.metadata(child.id).raise, undefined);
    assert.equal(f.metadata(child.id).ask, undefined);
    await pause(300);
    assert.equal(f.heard(parent.id, child.id).length, 1);
  } finally {
    await f.cleanup();
  }
});

test("what a parent already has is not sent again: a raise it answered, an answer it looked at", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    // The parent stays in its turn (waiting for its own slow processes) while its child raises and then answers.
    const hold = (title: string): ["start_process", object] => ["start_process", { command: `node -e "setTimeout(() => {}, 2500)"`, title }];
    const last = await f.answer(
      parent.id,
      steps(
        hold("first hold"),
        ["start_session", { brief: say("raise", { text: "A or B?" }), title: "Asker" }],
        ["wait", { ids: ["process-1"] }],
        // The raise waits for the parent's turn to end. Answering it here takes it.
        ["send", { id: "session-2", text: "A" }],
        hold("second hold"),
        ["wait", { ids: ["process-3"] }],
        // By now the child has answered, and that waits too. Looking at the child takes it.
        ["look", { id: "session-2" }],
      ),
    );
    const [child] = f.children(parent.id);
    assert.ok(child);
    assert.match(last, /^"Asker" — at rest\nThe session "Asker" \(session-2\) you started finished:\n\n/);
    assert.match(last, /local:A$/);
    await f.idle(parent.id);
    await pause(400);
    // Nothing from the child was sent to the parent afterwards; both are recorded as taken.
    assert.deepEqual(f.heard(parent.id, child.id, "raised"), []);
    assert.deepEqual(f.heard(parent.id, child.id), []);
    const records = JSON.parse(readFileSync(join(f.home, "sessions", parent.id, "wakes.json"), "utf8")).records[child.id] as { outcome: string }[];
    assert.deepEqual(records.map((record) => record.outcome), ["handled", "handled"]);
  } finally {
    await f.cleanup();
  }
});

// ---- Wait: asks compose. All is a join, any is a race, one after another is a pipeline ----

test("join: a parent waits for every session it started and takes their answers together", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    const joined = await f.answer(parent.id, steps(["start_session", { brief: "alpha", title: "A" }], ["start_session", { brief: "beta", title: "B" }], ["wait"]));
    assert.equal(joined, 'session-1: "A" finished:\n\nlocal:alpha\n\nsession-2: "B" finished:\n\nlocal:beta');
    // The answers were taken in the turn, so nothing is sent afterwards.
    await f.idle(parent.id);
    await pause(400);
    assert.equal(f.runtime.items(parent.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY).length, 0);
    assert.equal(await f.answer(parent.id, say("wait")), "Nothing this session started is still open.");
    // A child that answered before says so, when it is named.
    assert.match(await f.answer(parent.id, say("wait", { ids: ["session-1"] })), /^session-1: "A" — at rest\. It gave its answer before/);
  } finally {
    await f.cleanup();
  }
});

test("race: wait for any returns with the first answer; the parent stops the rest", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    const slow = steps(["start_process", { command: `node -e "setTimeout(() => {}, 20000)"`, title: "long job" }], ["wait"]);
    const raced = await f.answer(
      parent.id,
      steps(["start_session", { brief: slow, title: "Slow" }], ["start_session", { brief: "quick", title: "Quick" }], ["wait", { for: "any", seconds: 30 }], ["stop", { id: "session-1" }]),
    );
    assert.equal(raced, "Stopped.");
    const waited = f.runtime.items(parent.id, {}).items.filter((item) => item.role === "toolResult").map(text).at(-2);
    assert.equal(waited, 'session-2: "Quick" finished:\n\nlocal:quick\n\nStill open: session-1.');
    await f.idle(parent.id);
    await pause(400);
    assert.equal(f.runtime.items(parent.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY).length, 0);
  } finally {
    await f.cleanup();
  }
});

test("pipeline: one after another, each answer in hand before the next starts", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.answer(
      parent.id,
      steps(["start_session", { brief: "draft", title: "Writer" }], ["wait", { ids: ["session-1"] }], ["start_session", { brief: "review the draft", title: "Reviewer" }], ["wait", { ids: ["session-2"] }]),
    );
    const results = f.runtime.items(parent.id, {}).items.filter((item) => item.role === "toolResult").map(text);
    assert.deepEqual([results[1], results[3]], ['session-1: "Writer" finished:\n\nlocal:draft', 'session-2: "Reviewer" finished:\n\nlocal:review the draft']);
    // The reviewer was started only once the writer's answer was in.
    const [writer, reviewer] = f.children(parent.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    assert.ok(f.runtime.items(writer!.id, {}).items.some((item) => text(item) === "local:draft"));
    assert.equal(reviewer!.title, "Reviewer");
  } finally {
    await f.cleanup();
  }
});

test("a wait never traps its session: a raise from what it started ends it, with the raise in hand", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    const waited = await f.answer(parent.id, steps(["start_session", { brief: say("raise", { text: "A or B?" }), title: "Asker" }], ["wait"]));
    assert.equal(
      waited,
      'The session "Asker" (session-1) you started raises this, and waits for your answer (pispark_send):\n\nA or B?\n\nThe wait ended early: something this session started raised (above). Still open: session-1.',
    );
    // It answers and waits again: this time the answer comes.
    const answered = await f.answer(parent.id, steps(["send", { id: "session-1", text: "B" }], ["wait"]));
    assert.match(answered, /^session-1: "Asker" finished:\n\n/);
    assert.match(answered, /local:B$/);
    await f.idle(parent.id);
    await pause(400);
    assert.equal(f.runtime.items(parent.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY).length, 0);
  } finally {
    await f.cleanup();
  }
});

test("a wait never traps its session: a message the person types ends it, and is read next", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    const run = f.runtime.start(session.id, steps(["start_process", { command: `node -e "setTimeout(() => {}, 20000)"`, title: "long job" }], ["wait"]));
    // The wait is under way once the start has answered.
    await eventually(() => f.runtime.items(session.id, {}).items.some((item) => item.role === "toolResult"));
    await pause(300);
    await f.runtime.queue(session.id, "never mind, stop there", "steer");
    await run.completion;
    const items = f.runtime.items(session.id, {}).items;
    assert.equal(text(items.filter((item) => item.role === "toolResult").at(-1)!), "The wait ended early: a message arrived for this session. Still open: process-1.");
    assert.equal(text(items.findLast((item) => item.role === "assistant")!), "local:never mind, stop there");
    f.runtime.stopProcess(session.id, f.runtime.listProcesses(session.id)[0]!.id);
  } finally {
    await f.cleanup();
  }
});

test("from a session the person started, a note and a raise are for the person; their next message answers the raise", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.folder });
    assert.equal(await f.answer(session.id, say("note", { text: "indexing done" })), "Noted for the person.");
    assert.equal(await f.answer(session.id, say("raise", { text: "Ship it today?" })), "Raised with the person.");
    assert.equal(f.metadata(session.id).raise, "Ship it today?");
    await f.runtime.start(session.id, "yes, ship it").completion;
    assert.equal(f.metadata(session.id).raise, undefined);
  } finally {
    await f.cleanup();
  }
});

test("a parent stops a child and what it started; it knows, so no answer comes back", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    const server = `node -e "setInterval(() => {}, 1000)"`;
    await f.runtime.start(parent.id, say("start_session", { brief: say("start_process", { command: server, title: "server" }), title: "Runner" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await f.idle(child.id);
    await eventually(() => f.runtime.listProcesses(child.id)[0]?.state === "running");
    // Its run ended with a process still running: it is not at rest.
    assert.equal(await f.answer(parent.id, say("look")), 'session-1: "Runner" — waiting for what it started');

    assert.equal(await f.answer(parent.id, say("stop", { id: "session-1" })), "Stopped.");
    await eventually(() => f.runtime.listProcesses(child.id)[0]?.state === "stopped", 20_000);
    await pause(300);
    assert.equal(f.runtime.items(parent.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY).length, 0);
    assert.equal(await f.answer(parent.id, say("look")), 'session-1: "Runner" — at rest');
  } finally {
    await f.cleanup();
  }
});

test("a message to a working child reaches it at once, even while it waits, and is part of the same answer", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    // The child starts a slow process and waits for it in its turn: it is working for a few seconds.
    const slow = `node -e "setTimeout(() => console.log('built'), 3000)"`;
    const brief = steps(["start_process", { command: slow, title: "build" }], ["wait", { ids: ["process-1"] }]);
    await f.runtime.start(parent.id, say("start_session", { brief, title: "Builder" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await eventually(() => f.runtime.listProcesses(child.id).length === 1);
    assert.equal(await f.answer(parent.id, say("send", { id: "session-1", text: "also run the linter" })), "Sent. It reads this at its next pause.");
    await eventually(() => f.heard(parent.id, child.id).length === 1, 20_000);
    // The message ended its wait, so the process's end reached it afterwards: both replies are its one answer.
    const answer = f.heard(parent.id, child.id)[0]!;
    assert.ok(answer.indexOf("local:also run the linter") > 0 && answer.indexOf('local:The process "build" (process-1) exited 0') > answer.indexOf("local:also run the linter"), answer);
    await pause(300);
    assert.equal(f.heard(parent.id, child.id).length, 1);
  } finally {
    await f.cleanup();
  }
});

test("archiving a parent takes its children along; restore brings them back; delete removes them", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(parent.id, say("start_session", { brief: "work", title: "Child" })).completion;
    const [child] = f.children(parent.id);
    await eventually(() => f.heard(parent.id, child!.id).length === 1);
    await f.idle(parent.id);
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

test("the parent's extensions see a child's answer first: they may take it or reword it, with the child's data", async () => {
  const f = await fixture();
  try {
    await f.agent("orchestrator", { name: "Orchestrator" }, { "extensions/orchestrate.mjs": ORCHESTRATE });
    const parent = await f.runtime.create({ folder: f.folder, agent: "orchestrator" });
    const submit = `tool:submit:${JSON.stringify({ value: "42" })}`;
    await f.runtime.start(parent.id, say("start_session", { brief: submit, title: "Reword" })).completion;
    await eventually(() => f.runtime.items(parent.id, {}).items.some((item) => item.customType === WOKEN_ENTRY));
    const items = f.runtime.items(parent.id, {}).items;
    const woken = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.equal(text(items[woken + 1]!), 'Reworded: {"value":"42"}');

    // Taken by the extension: nothing wakes the agent; the record says so.
    await f.idle(parent.id);
    await f.runtime.start(parent.id, say("start_session", { brief: "quiet work", title: "Skip me" })).completion;
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

test("a child answers once, when at rest: a process it still waits for holds the answer, and what it said before is in it", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    // The child's first turn starts a process that outlives the turn.
    const slow = `node -e "setTimeout(() => console.log('tests passed'), 3000)"`;
    await f.runtime.start(parent.id, say("start_session", { brief: say("start_process", { command: slow, title: "tests" }), title: "Builder" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await f.idle(child.id);
    assert.equal(f.runtime.listProcesses(child.id)[0]?.state, "running");
    // Its run ended, but it is not at rest: nothing reaches the parent.
    await pause(300);
    assert.deepEqual(f.heard(parent.id, child.id), []);

    // The process ends and wakes the child. That run leaves nothing to wait for: one answer.
    await eventually(() => f.heard(parent.id, child.id).length === 1, 20_000);
    const [body] = f.heard(parent.id, child.id);
    assert.match(body!, /^The session "Builder" \(session-1\) you started finished:\n\n/);
    // Everything it said since it was asked: its first turn's closing words, then its second's.
    const first = body!.indexOf("local:[");
    const second = body!.indexOf('local:The process "tests" (process-1) exited 0');
    assert.ok(first > 0 && second > first, body);
    await pause(300);
    assert.equal(f.heard(parent.id, child.id).length, 1);
  } finally {
    await f.cleanup();
  }
});

test("a process end the child has already taken is not told again: one run, one answer", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    // The child waits for the process in its turn, and takes its result there.
    const quick = `node -e "console.log('done')"`;
    const brief = steps(["start_process", { command: quick, title: "quick" }], ["wait", { ids: ["process-1"] }]);
    await f.runtime.start(parent.id, say("start_session", { brief, title: "Checker" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await eventually(() => f.heard(parent.id, child.id).length === 1, 20_000);
    await pause(400);
    // The end was not sent to the child as a second message, so the child ran once.
    const childItems = f.runtime.items(child.id, {}).items;
    assert.equal(childItems.filter((item) => item.customType === WOKEN_ENTRY && (item.details as { source: { kind: string } }).source.kind === "process").length, 0);
    assert.equal(childItems.filter((item) => item.role === "assistant" && text(item).startsWith("local:")).length, 1);
    assert.equal(f.heard(parent.id, child.id).length, 1);
  } finally {
    await f.cleanup();
  }
});

test("a run its parent did not ask for tells the parent nothing; a new message from the parent is a new ask", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    await f.runtime.start(parent.id, say("start_session", { brief: "look into it", title: "Looker" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await eventually(() => f.heard(parent.id, child.id).length === 1);
    await f.idle(parent.id);

    // The person talks to the child: its answer is theirs, in the child's conversation.
    await f.runtime.start(child.id, "and one more thing").completion;
    await pause(300);
    assert.equal(f.heard(parent.id, child.id).length, 1);

    // The parent sends again: one more answer, holding only what was said since.
    await f.runtime.start(parent.id, say("send", { id: "session-1", text: "second question" })).completion;
    await eventually(() => f.heard(parent.id, child.id).length === 2);
    assert.match(f.heard(parent.id, child.id)[1]!, /finished:\n\nlocal:second question$/);
  } finally {
    await f.cleanup();
  }
});

test("the real case in small: several processes, some already taken, one answer to the parent", async () => {
  const f = await fixture();
  try {
    const parent = await f.runtime.create({ folder: f.folder });
    // Two checks the child waits for in its turn, and one that ends after the turn.
    const check = (title: string): ["start_process", object] => ["start_process", { command: `node -e "console.log('done')"`, title }];
    const late: ["start_process", object] = ["start_process", { command: `node -e "setTimeout(() => console.log('late'), 3000)"`, title: "late check" }];
    const brief = steps(check("typecheck"), check("unit tests"), late, ["wait", { ids: ["process-1", "process-2"] }]);
    await f.runtime.start(parent.id, say("start_session", { brief, title: "Implementer" })).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    await eventually(() => f.heard(parent.id, child.id).length === 1, 20_000);
    await pause(400);
    // Only the end it had not taken was sent to it; its parent heard once.
    const woken = f.runtime.items(child.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY).map((item) => (item.details as { source: { kind: string; label: string } }).source);
    assert.deepEqual(woken.filter((source) => source.kind === "process").map((source) => source.label), ["late check · exited 0"]);
    assert.equal(f.heard(parent.id, child.id).length, 1);
  } finally {
    await f.cleanup();
  }
});
