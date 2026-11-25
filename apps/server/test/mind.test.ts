import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
