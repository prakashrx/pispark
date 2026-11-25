import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { Mind } from "../../../plugins/extensions/mind/store.js";
import { audit } from "../../../plugins/extensions/mind/audit.js";
import { quotes, startedByPerson } from "../../../plugins/extensions/mind/index.js";
import { testHome } from "./fixtures/home.js";
import { eventually, type LocalRequest } from "./fixtures/local-provider.js";
import { noticeText, sessionText } from "./fixtures/session.js";

/** The mind section the model has now: Pi patches changed sections in later system messages. */
const systemText = (request: LocalRequest) =>
  (request.context.messages as { role: string; sections?: Record<string, string> }[])
    .filter((m) => m.role === "system" && m.sections?.mind !== undefined).at(-1)?.sections?.mind ?? "";
const call = (name: string, args: object) => `tool:${name}:${JSON.stringify(args)}`;

async function fixture() {
  const h = await testHome("pispark-mind-");
  h.provider.automatic = true;
  const runtime = new SessionRuntime(h.configuration);
  const place = await h.folder("place", { "README.md": "A place." });
  await h.agent("mindful", { name: "Mindful", resources: { extensions: ["bundled:mind"] } });
  const start = async (id: string, text: string) => (await runtime.start(id, text).completion).outcome;
  const json = async (name: string) => {
    const file = join(place, ".mind", `${name}.json`);
    return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : { rules: [], notes: [], items: [], cards: [], proposals: [] };
  };
  return {
    ...h, runtime, place, start, json,
    cleanup: async () => {
      await runtime.shutdown();
      await h.remove();
    },
  };
}

test("mind: a fresh place pins an empty charter and contract; the first write makes .mind/, ignored by git", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(session.id, "hello");
    const system = systemText(f.provider.requests.at(-1)!);
    assert.match(system, /<mind>/);
    assert.match(system, /finding out what you're here for is your first goal/);
    assert.match(system, /discover/);
    assert.ok(!existsSync(join(f.place, ".mind")), "nothing is written until something is remembered");
    await f.start(session.id, call("mind_work", { action: "start", goal: "Ship the importer", doneWhen: "a real export imports" }));
    assert.match(await readFile(join(f.place, ".mind", ".gitignore"), "utf8"), /^\*$/m);
  } finally {
    await f.cleanup();
  }
});

test("mind: what the person says is recorded, what is inferred is proposed; the person accepts with /mind", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    // Told, quoting the person's own words from this run.
    await f.start(session.id, call("mind_record", { op: "add", origin: "told", part: "contract", when: "a fix is routine", act: "own", what: "it end to end", quote: "a fix is routine" }));
    assert.equal((await f.json("contract")).rules[0].origin, "told");
    // Told without the person's words: it becomes a proposal.
    await f.start(session.id, call("mind_record", { op: "add", origin: "told", part: "knowledge", claim: "Releases go out from main", why: "Every merge to main publishes a prerelease" }));
    // Inferred: a proposal.
    await f.start(session.id, call("mind_record", { op: "add", origin: "inferred", part: "charter", section: "good", text: "Quiet by default", reason: "Said twice while reviewing screens" }));
    const proposals = (await f.json("proposals")).proposals;
    assert.equal(proposals.length, 2);
    assert.equal((await f.json("knowledge")).notes.length, 0);
    await f.start(session.id, `/mind accept ${proposals[1].id}`);
    await f.start(session.id, `/mind reject ${proposals[0].id}`);
    assert.deepEqual((await f.json("charter")).items.map((i: { text: string; origin: string }) => [i.text, i.origin]), [["Quiet by default", "told"]]);
    assert.equal((await f.json("proposals")).proposals.length, 0);
    await f.start(session.id, "after");
    const system = systemText(f.provider.requests.at(-1)!);
    assert.match(system, /When a fix is routine, I own it end to end\./);
    assert.match(system, /What good looks like: Quiet by default/);
  } finally {
    await f.cleanup();
  }
});

test("mind: raw writes into .mind/ are refused; reading is fine", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(session.id, call("mind_work", { action: "add", goal: "An idea" }));
    const before = await readFile(join(f.place, ".mind", "work.json"), "utf8");
    await f.start(session.id, call("write", { path: ".mind/work.json", content: "{}" }));
    await f.start(session.id, call("edit", { path: join(f.place, ".mind", "work.json"), edits: [{ oldText: "An idea", newText: "Hacked" }] }));
    await f.start(session.id, call("bash", { command: "echo x > .mind/work.json" }));
    assert.equal(await readFile(join(f.place, ".mind", "work.json"), "utf8"), before);
    assert.match(sessionText(f.runtime, session.id), /written only through the mind tools/);
    await f.start(session.id, "read:.mind/work.json");
    assert.match(sessionText(f.runtime, session.id), /An idea/);
  } finally {
    await f.cleanup();
  }
});

test("mind: cards stay pinned across reopening; this session's card lives in the session and can be promoted", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(session.id, call("mind_work", { action: "start", goal: "Ship the importer", doneWhen: "a real export imports", authority: "merge when green" }));
    const id = (await f.json("work")).cards[0].id;
    await f.start(session.id, call("mind_work", { action: "update", id, state: "parser done", next: "wire the UI" }));
    await f.start(session.id, call("mind_work", { action: "start", scope: "session", goal: "Check the parser edge cases" }));
    await f.runtime.stop(session.id);
    await f.runtime.open(session.id);
    await f.start(session.id, "after reopening");
    let system = systemText(f.provider.requests.at(-1)!);
    assert.match(system, /Ship the importer · done when: a real export imports · stage: active · state: parser done · next: wire the UI · authorised: merge when green/);
    assert.match(system, /This session: \[\w+\] Check the parser edge cases/);
    // Another session in the same place sees the place's card, not this session's.
    const other = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(other.id, "hello");
    system = systemText(f.provider.requests.at(-1)!);
    assert.match(system, /Ship the importer/);
    assert.doesNotMatch(system, /Check the parser edge cases/);
    await f.start(session.id, call("mind_work", { action: "promote", id: "session" }));
    assert.equal((await f.json("work")).cards.length, 2);
    await f.start(session.id, call("mind_work", { action: "done", id }));
    await f.start(session.id, "after");
    assert.doesNotMatch(systemText(f.provider.requests.at(-1)!), /Ship the importer/);
  } finally {
    await f.cleanup();
  }
});

test("mind: the place's own skills load; /mind shows what waits on the person", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.place, ".mind", "skills", "release"), { recursive: true });
    await writeFile(join(f.place, ".mind", "skills", "release", "SKILL.md"), "---\nname: release\ndescription: PLACE-RELEASE how we release here\n---\nSteps");
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(session.id, call("mind_record", { op: "add", origin: "inferred", part: "knowledge", claim: "Tests run on dev2", why: "The shared dev server restarts", reason: "Seen in two sessions" }));
    assert.match(JSON.stringify(f.provider.requests.at(-1)!.context.messages.filter((m) => m.role === "system")), /PLACE-RELEASE how we release here/);
    await f.start(session.id, "/mind");
    await eventually(() => noticeText(f.runtime, session.id).some((line) => /Waiting on you/.test(line)));
  } finally {
    await f.cleanup();
  }
});

test("mind store: shapes and budgets hold; the audit flags strays, goal detail and staleness", async () => {
  const root = await mkdtemp(join(tmpdir(), "pispark-mind-store-"));
  try {
    const m = new Mind(root);
    const told = { origin: "told" as const, source: "s", at: new Date().toISOString() };
    await assert.rejects(m.apply({ part: "contract", when: "x", act: "maybe" as never, what: "y" }, told), /When <situation>/);
    await assert.rejects(m.apply({ part: "knowledge", claim: "", why: "y" }, told), /claim is required/);
    for (let i = 0; i < 17; i++) await m.apply({ part: "knowledge", claim: `${"A lasting fact about this place ".repeat(7)}${i}`, why: "It matters" }, told);
    await assert.rejects(m.apply({ part: "knowledge", claim: "One more lasting fact ".repeat(10), why: "It matters" }, told), /over its 1000-token budget/);
    await m.apply({ part: "knowledge", claim: "Fixed in commit 1ee2326 on feat/agent-memory", why: "It was a bug" }, told);
    await writeFile(join(m.dir, "notes.md"), "stray");
    const findings = await audit(m);
    assert.ok(findings.some((x) => x.kind === "stray" && /notes\.md/.test(x.text)));
    assert.ok(findings.some((x) => x.kind === "goal-detail"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mind: only a run the person started can record told items, and only in their own words", () => {
  const woken = [{ type: "message" }, { type: "custom", customType: "pispark:woken" }];
  assert.equal(startedByPerson("user", [{ type: "message" }]), true);
  assert.equal(startedByPerson("user", woken), false);
  assert.equal(startedByPerson("user", [...woken, { type: "message" }]), false);
  assert.equal(startedByPerson("custom", [{ type: "message" }]), false);
  assert.equal(quotes("From now on, just   push when CI is green.", "just push when CI is green"), true);
  assert.equal(quotes("From now on, just push when CI is green.", "always push"), false);
  assert.equal(quotes(undefined, "just push"), false);
  assert.equal(quotes("anything", ""), false);
});

test("mind: after a compaction the card is still pinned and the agent is told to reorient", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(session.id, call("mind_work", { action: "start", goal: "Add a servings option", doneWhen: "the output format is unchanged" }));
    for (let i = 0; i < 3; i++) await f.start(session.id, "The old conversation has useful context. ".repeat(1200));
    await f.runtime.compact(session.id);
    await f.start(session.id, "where were we?");
    const mind = systemText(f.provider.requests.at(-1)!);
    assert.match(mind, /Add a servings option · done when: the output format is unchanged · stage: active/);
    assert.match(mind, /just compacted: re-read the active card/);
    await f.start(session.id, "and now?");
    assert.doesNotMatch(systemText(f.provider.requests.at(-1)!), /just compacted/);
  } finally {
    await f.cleanup();
  }
});

test("mind: a decision is one short question with a recommendation; a yes to 'handle it yourself' becomes a rule, asked once", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    const answer = async (value: string | boolean | null) => {
      await eventually(() => f.runtime.session(session.id).extensions.dialogs.length === 1);
      const dialog = f.runtime.session(session.id).extensions.dialogs[0]!;
      f.runtime.answer(session.id, dialog.id, value);
      return dialog;
    };
    let run = f.start(session.id, call("mind_decide", { question: "Rename the CLI flag?", recommended: "Keep --factor", others: ["Rename to --scale"], ifNoAnswer: "I keep --factor." }));
    const dialog = await answer("Keep --factor (recommended)");
    assert.equal(dialog.kind, "select");
    await run;
    assert.match(sessionText(f.runtime, session.id), /The person chose: Keep --factor/);
    run = f.start(session.id, call("mind_decide", { question: "Delete the old fixtures?", recommended: "Keep them", others: [], ifNoAnswer: "I keep them." }));
    await answer(null);
    await run;
    assert.match(sessionText(f.runtime, session.id), /No answer\. I keep them\./);

    const own = { op: "add", origin: "ask", part: "contract", when: "tests fail on a typo", act: "own", what: "the fix without asking" };
    run = f.start(session.id, call("mind_record", own));
    const asked = await answer(true);
    assert.equal(asked.kind, "confirm");
    await run;
    const rule = (await f.json("contract")).rules[0];
    assert.equal(rule.origin, "told");
    assert.match(rule.quote, /Next time, handle this yourself\?/);
    // The same situation isn't asked twice in a session.
    await f.start(session.id, call("mind_record", own));
    assert.equal(f.runtime.session(session.id).extensions.dialogs.length, 0);
    assert.match(sessionText(f.runtime, session.id), /Already asked in this session/);
    // A no records nothing.
    run = f.start(session.id, call("mind_record", { op: "add", origin: "ask", part: "knowledge", claim: "Fixtures are generated", why: "They must not be edited by hand" }));
    await answer(false);
    await run;
    assert.equal((await f.json("knowledge")).notes.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("mind: a run whose words read like a lesson gets one hidden reminder to keep it; others don't", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(session.id, "hello there");
    assert.equal(f.provider.requests.length, 1);
    await f.start(session.id, "Docs should always state the Python version. Fix it.");
    await eventually(() => f.provider.requests.length === 3);
    assert.match(JSON.stringify(f.provider.requests.at(-1)!.context.messages.at(-1)), /Before you finish: did the person's last message carry a lesson/);
    assert.doesNotMatch(sessionText(f.runtime, session.id), /"customType":"mind-lesson"/, "the reminder isn't shown");
    // Recording in the run itself needs no reminder.
    await f.start(session.id, call("mind_record", { op: "add", origin: "told", part: "contract", when: "docs change", act: "own", what: "stating the Python version", quote: "always" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(f.provider.requests.length, 5, "the tool call and its follow-up only");
  } finally {
    await f.cleanup();
  }
});

test("mind: closing a card starts a reflection child in the same place; skills it proposes load once accepted; closed cards retire", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(session.id, call("mind_work", { action: "start", goal: "Release 1.0" }));
    const id = (await f.json("work")).cards[0].id;
    await f.start(session.id, call("mind_work", { action: "done", id }));
    await eventually(() => f.runtime.list().some((s) => s.parent === session.id));
    const child = f.runtime.list().find((s) => s.parent === session.id)!;
    assert.match(child.title ?? "", /^Reflect · Release 1\.0/);
    assert.equal(child.folder, f.place);
    assert.match(sessionText(f.runtime, session.id), /Reflection started in the background/);
    await eventually(() => /Reflect on this closed goal, using the reflect skill/.test(sessionText(f.runtime, child.id)));
    assert.match(sessionText(f.runtime, child.id), new RegExp(`retire the card: mind_work action \\\\"retire\\\\", id \\\\"${id}\\\\"`));
    // Reflection proposes; the person accepts.
    await eventually(() => f.runtime.list().find((s) => s.id === child.id)?.status === "idle");
    await f.start(child.id, call("mind_record", { op: "add", origin: "inferred", part: "skill", name: "release", description: "How we release here", body: "1. Tag.\n2. Publish.", reason: "Worked out while releasing 1.0" }));
    await f.start(child.id, call("mind_work", { action: "retire", id }));
    assert.equal((await f.json("work")).cards.length, 0);
    const [proposal] = (await f.json("proposals")).proposals;
    assert.equal(proposal.item.part, "skill");
    assert.ok(!existsSync(join(f.place, ".mind", "skills", "release")));
    await f.start(session.id, `/mind accept ${proposal.id}`);
    assert.match(await readFile(join(f.place, ".mind", "skills", "release", "SKILL.md"), "utf8"), /name: release\ndescription: "How we release here"[\s\S]*1\. Tag\./);
    const other = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(other.id, "hello");
    assert.match(JSON.stringify(f.provider.requests.at(-1)!.context.messages.filter((m) => m.role === "system")), /How we release here/);
    // The child can't start reflections of its own.
    await f.start(child.id, call("mind_work", { action: "start", goal: "Nested" }));
    const nested = (await f.json("work")).cards[0].id;
    await f.start(child.id, call("mind_work", { action: "done", id: nested }));
    assert.match(sessionText(f.runtime, child.id), /Reflection could not start/);
  } finally {
    await f.cleanup();
  }
});

test("mind: the Mind view shows what waits on the person; accepting, rejecting and forgetting there apply at once", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.create({ folder: f.place, agent: "mindful" });
    await f.start(session.id, call("mind_record", { op: "add", origin: "inferred", part: "knowledge", claim: "Fixtures are generated", why: "Editing them by hand is lost on the next run", reason: "Seen while testing" }));
    await f.start(session.id, call("mind_record", { op: "add", origin: "inferred", part: "charter", section: "good", text: "Small diffs", reason: "Asked twice" }));
    const view = () => f.runtime.session(session.id).extensions.views.find((v) => v.point === "session.view" && v.key === "mind");
    await eventually(() => (view()?.props as { snapshot?: { proposals: unknown[] } } | undefined)?.snapshot?.proposals.length === 2);
    assert.equal(view()!.title, "Mind");
    const [first, second] = (await f.json("proposals")).proposals;
    await f.runtime.call(session.id, "session.view", "mind", "accept", { id: first.id });
    await f.runtime.call(session.id, "session.view", "mind", "reject", { id: second.id });
    const snapshot = (view()!.props as { snapshot: { proposals: unknown[]; notes: { id: string; claim: string }[] } }).snapshot;
    assert.equal(snapshot.proposals.length, 0);
    assert.deepEqual(snapshot.notes.map((n) => n.claim), ["Fixtures are generated"]);
    await f.runtime.call(session.id, "session.view", "mind", "forget", { id: snapshot.notes[0]!.id });
    assert.equal((await f.json("knowledge")).notes.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("mind: the Mind view compiles as PiSpark compiles extension views", async () => {
  const { compileView, viewBundle } = await import("../src/core/extensions/view-compiler.js");
  const folder = fileURLToPath(new URL("../../../plugins/extensions/mind/", import.meta.url));
  const hash = await compileView(join(folder, "Mind.svelte"), folder);
  assert.ok((viewBundle(hash) ?? "").length > 0);
});
