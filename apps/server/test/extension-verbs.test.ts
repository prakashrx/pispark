import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { STATUS_ENTRY, WOKEN_ENTRY } from "../src/contract/wake-protocol.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";
import { say, steps } from "./fixtures/verbs.js";

/**
 * An extension is code inside a session and speaks as that session: it hears what reaches the
 * session before the agent does, says the same ten verbs, and passes data where an agent passes
 * words.
 */
const text = (item: { parts: { type: string; text?: string }[] }) => item.parts.map((part) => part.text ?? "").join("");

async function fixture() {
  const h = await testHome("pispark-extension-verbs-");
  h.provider.automatic = true;
  const runtime = new SessionRuntime({ ...h.configuration, wakeTickMs: 0 });
  const folder = await h.folder("work");
  return {
    ...h,
    runtime,
    folder,
    idle: (id: string) => eventually(() => runtime.list().find((s) => s.id === id)?.status === "idle"),
    children: (id: string) => runtime.list().filter((session) => session.parent === id),
    cleanup: async () => {
      await runtime.shutdown();
      await h.remove();
    },
  };
}

/** Writes down everything it hears; takes a note itself and rewords a raise. */
const LISTENER = `
import { appendFileSync } from "node:fs";
import { join } from "node:path";
export default function (pi) {
  let cwd;
  pi.on("session_start", (_event, ctx) => { cwd = ctx.cwd; });
  pi.events.on("pispark:heard", (heard) => {
    const { reply, ...kept } = heard;
    appendFileSync(join(cwd, "heard.jsonl"), JSON.stringify(kept) + "\\n");
    if (heard.word === "note") reply({ action: "skip" });
    if (heard.word === "raise") reply({ action: "send", text: "The child asks: " + heard.text });
  });
}
`;

test("an extension hears whatever reaches its session first, and may take it or reword it", async () => {
  const f = await fixture();
  try {
    await f.agent("listener", { name: "Listener" }, { "extensions/listen.mjs": LISTENER });
    const parent = await f.runtime.create({ folder: f.folder, agent: "listener" });
    const brief = steps(["note", { text: "half way" }], ["raise", { text: "A or B?" }]);
    await f.runtime.start(parent.id, steps(["start_session", { brief, title: "Asker" }], ["start_process", { command: `node -e "console.log('built')"`, title: "build" }])).completion;
    const [child] = f.children(parent.id);
    assert.ok(child);
    const heard = () => (existsSync(join(f.folder, "heard.jsonl")) ? readFileSync(join(f.folder, "heard.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []);
    await eventually(() => heard().length === 3, 15_000);
    const of = (word: string, kind: string) => heard().find((each) => each.word === word && each.from.kind === kind);
    assert.deepEqual(of("note", "session"), { word: "note", from: { id: "session-1", kind: "session", title: "Asker" }, text: "half way" });
    assert.deepEqual(of("raise", "session"), { word: "raise", from: { id: "session-1", kind: "session", title: "Asker" }, how: "raised", text: "A or B?" });
    assert.deepEqual({ ...of("answer", "process"), text: of("answer", "process").text.trim() }, { word: "answer", from: { id: "process-2", kind: "process", title: "build" }, how: "exited 0", text: "built" });

    await f.idle(parent.id);
    const items = f.runtime.items(parent.id, {}).items;
    // The note it took is no line; the raise it reworded is what the agent was sent.
    assert.equal(items.filter((item) => item.customType === STATUS_ENTRY).length, 0);
    assert.ok(items.some((item) => item.role === "user" && text(item).includes("The child asks: A or B?")));

    // The child's answer is heard too, with how it ended.
    await f.runtime.start(parent.id, say("send", { id: "session-1", text: "B" })).completion;
    await eventually(() => heard().some((each) => each.word === "answer" && each.from.kind === "session"), 15_000);
    assert.deepEqual(of("answer", "session").from, { id: "session-1", kind: "session", title: "Asker" });
    assert.equal(of("answer", "session").how, "finished");
  } finally {
    await f.cleanup();
  }
});

/** A reviewer that works in code: it hears its ask with the data its parent attached, answers with data, and spends no model turn. */
const REVIEWER = `
export default function (pi) {
  pi.events.on("pispark:heard", (heard) => {
    if (heard.word !== "ask") return;
    const subject = heard.data.subject;
    pi.events.emit("pispark:result", { data: { reviewed: subject, askedBy: heard.from.title, verdict: Array.isArray(subject) ? "both read" : "fine" } });
    heard.reply({ action: "skip" });
  });
}
`;
/** A pipeline in code, in one session: two reviewers side by side, then a third with what they found. */
const PIPELINE = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export default function (pi) {
  let host;
  pi.events.emit("pispark:api", (api) => { host = api; });
  let started = false;
  pi.on("session_start", (event, ctx) => {
    if (started || event.reason !== "new" || !host) return;
    started = true;
    setTimeout(async () => {
      const review = (title, subject) => host.startSession({ brief: "Review " + title, title, agent: "reviewer", data: { subject }, collect: true });
      const a = await review("the parser", "parser");
      const b = await review("the lexer", "lexer");
      const both = await host.wait({ ids: [a.data.id, b.data.id] });
      const found = [both.data.answers[a.data.id].data, both.data.answers[b.data.id].data];
      const c = await review("both reviews", found);
      const last = await host.wait({ ids: [c.data.id] });
      const noted = await host.note("The pipeline is done");
      const refused = await host.startSession({ brief: "Review nothing", agent: "nobody", collect: true });
      writeFileSync(join(ctx.cwd, "pipeline.json"), JSON.stringify({ ids: [a.data.id, b.data.id, c.data.id], found, final: last.data.answers[c.data.id], noted: noted.text, open: last.data.open, refused }));
    }, 50);
  });
}
`;

test("an extension runs a two-reviewer pipeline in code: the same verbs, data both ways, and no turn of the parent's agent", async () => {
  const f = await fixture();
  try {
    await f.agent("reviewer", { name: "Reviewer" }, { "extensions/review.mjs": REVIEWER });
    await f.agent("pipeline", { name: "Pipeline" }, { "extensions/pipeline.mjs": PIPELINE });
    const parent = await f.runtime.create({ folder: f.folder, agent: "pipeline" });
    const result = join(f.folder, "pipeline.json");
    await eventually(() => existsSync(result), 20_000);
    const done = JSON.parse(readFileSync(result, "utf8"));
    assert.deepEqual(done.ids, ["session-1", "session-2", "session-3"]);
    // Data went down with each ask and came back up with each answer.
    assert.deepEqual(done.found, [
      { reviewed: "parser", askedBy: "a session", verdict: "fine" },
      { reviewed: "lexer", askedBy: "a session", verdict: "fine" },
    ]);
    assert.deepEqual(done.final.data, { reviewed: done.found, askedBy: "a session", verdict: "both read" });
    assert.equal(done.final.how, "finished");
    assert.deepEqual(done.open, []);
    // A start refused over its agent says which agents there are, as data for code.
    assert.equal(done.refused.ok, false);
    assert.ok(done.refused.data.agents.some((agent: { id: string; name: string }) => agent.id === "reviewer" && agent.name === "Reviewer"));
    assert.equal(done.noted, "Noted for the person.");
    // PiSpark decided no order and ran no model: the parent's agent took no turn, and neither did a reviewer's.
    assert.equal(f.provider.requests.length, 0);
    assert.equal(f.runtime.items(parent.id, {}).items.filter((item) => item.customType === WOKEN_ENTRY || item.role === "user" || item.role === "assistant").length, 0);
    assert.equal(f.children(parent.id).length, 3);
  } finally {
    await f.cleanup();
  }
});

test("outside PiSpark nothing answers: the functions say so, and an extension carries on", async () => {
  const { verbs } = await import("../src/contract/verbs.js");
  const api = verbs({ emit: () => {} });
  assert.deepEqual(await api.look(), { ok: false, text: "Not available here: this session is not hosted by PiSpark." });
});
