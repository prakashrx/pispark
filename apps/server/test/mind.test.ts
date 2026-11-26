import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { edited } from "../../../plugins/extensions/mind/index.js";
import { check, kindOf, refusePath } from "../../../plugins/extensions/mind/layout.js";
import { Mind } from "../../../plugins/extensions/mind/store.js";
import { questions, trimDone, withAnswer } from "../../../plugins/extensions/mind/tasks.js";
import { testHome } from "./fixtures/home.js";
import { eventually, type LocalRequest } from "./fixtures/local-provider.js";
import { sessionText } from "./fixtures/session.js";

const NOTES = "## What this is\nA notes app for one person.\n\n## How it's set up\nnginx in front of the app on port 8080.\n\n## Things to know\nBackups run nightly (you said).\n";
const TASKS = [
  "## Waiting on you",
  "- **Rotate the notes password?** I recommend rotating it tonight. Until you answer, nothing changes.",
  "",
  "## Doing",
  "- Watching nginx restarts. Next: check the logs at the next run.",
  "",
  "## To do",
  "- Add TLS.",
  "",
  "## Done lately",
  "- 2026-11-25: Fixed the backup path; nightly backups validated.",
  "",
].join("\n");
const EMPTY_TASKS = "## Waiting on you\n\n## Doing\n\n## To do\n\n## Done lately\n";

type SystemMessage = { role: string; sections?: Record<string, string> };
/** The mind section the model has now: Pi patches changed sections in later system messages. */
const briefOf = (request: LocalRequest) =>
  (request.context.messages as SystemMessage[]).filter((m) => m.role === "system" && m.sections?.mind !== undefined).at(-1)?.sections?.mind ?? "";
const systemOf = (request: LocalRequest) => JSON.stringify(request.context.messages.filter((m) => m.role === "system"));
const lastOf = (request: LocalRequest) => JSON.stringify(request.context.messages.at(-1));
const call = (name: string, args: object) => `tool:${name}:${JSON.stringify(args)}`;

async function fixture() {
  const h = await testHome("pispark-mind-");
  h.provider.automatic = true;
  const runtime = new SessionRuntime(h.configuration);
  const place = await h.folder("place", { "README.md": "A place." });
  await h.agent("mindful", { name: "Mindful", resources: { extensions: ["bundled:mind"] } });
  const start = async (id: string, text: string) => (await runtime.start(id, text).completion).outcome;
  const file = (rel: string) => join(place, ".mind", rel);
  const read = (rel: string) => readFile(file(rel), "utf8");
  const put = async (rel: string, content: string) => {
    await mkdir(join(file(rel), ".."), { recursive: true });
    await writeFile(file(rel), content);
  };
  return {
    ...h, runtime, place, start, file, read, put,
    create: () => runtime.create({ folder: place, agent: "mindful" }),
    cleanup: async () => {
      await runtime.shutdown();
      await h.remove();
    },
  };
}

test("mind layout: every path has one kind, and each document has one shape", () => {
  assert.deepEqual(
    ["notes.md", "tasks.md", "notes/release-steps.md", "attachments/report.pdf", "skills/fix-backup/SKILL.md", "skills/fix-backup/scripts/check.sh", ".history/x.json", "todo.md", "notes/Release.md", "work/item.md"].map(kindOf),
    ["notes", "tasks", "page", "attachment", "skill", "skill-file", "internal", "stray", "stray", "stray"],
  );
  assert.equal(refusePath("notes.md"), undefined);
  assert.match(refusePath("todo.md")!, /not part of the layout/);
  assert.match(refusePath(".state.json")!, /kept by the extension/);
  assert.match(refusePath("notes/Release Steps.md")!, /lowercase, hyphenated/);

  assert.equal(check("notes.md", NOTES), undefined);
  assert.equal(check("notes.md", NOTES.replace("it's", "it\u2019s")), undefined, "a typographic apostrophe is the same heading");
  assert.match(check("notes.md", NOTES + "\n## History\n- 2026: things happened\n")!, /exactly these sections/);
  assert.match(check("notes.md", NOTES + "x".repeat(6000))!, /Move detail into a page/);
  assert.equal(check("notes.md", NOTES + "\n```\n## not a heading\n```\n"), undefined, "a heading inside a code block is not a section");

  assert.equal(check("tasks.md", TASKS), undefined);
  assert.match(check("tasks.md", TASKS.replace("## Doing", "## In progress"))!, /exactly these sections/);
  assert.match(check("tasks.md", TASKS.replace("- Add TLS.", "Add TLS."))!, /one bullet/);
  assert.match(check("tasks.md", TASKS.replace("- 2026-11-25: Fixed", "- Fixed"))!, /starts with its date/);

  assert.equal(check("notes/release.md", "# Releasing\nHow a release is cut and checked.\n\nSteps follow.\n"), undefined);
  assert.match(check("notes/release.md", "Releasing\n")!, /starts with its title/);
  assert.match(check("notes/release.md", "# Releasing\n## Steps\n")!, /one-sentence summary/);

  const skill = "---\nname: fix-backup\ndescription: Check and repair the nightly backup on this server.\n---\nSteps\n";
  assert.equal(check("skills/fix-backup/SKILL.md", skill), undefined);
  assert.match(check("skills/repair/SKILL.md", skill)!, /must be its folder name/);
  assert.match(check("skills/fix-backup/SKILL.md", skill.replace(/description: .*/, "description: Backups"))!, /what it does and when to use it/);
});

test("mind tasks: questions are found, an answer is written under its question, and Done lately keeps the newest", () => {
  const [question] = questions(TASKS);
  assert.equal(question!.text, "**Rotate the notes password?** I recommend rotating it tonight. Until you answer, nothing changes.");
  assert.equal(question!.answer, undefined);
  const answered = withAnswer(TASKS, question!.id, "Yes,  do it.", "2026-11-26")!;
  assert.match(answered, /nothing changes\.\n  - Answer \(2026-11-26\): Yes, do it\.\n\n## Doing/);
  assert.equal(questions(answered)[0]!.answer, "Yes, do it.");
  assert.equal(questions(answered)[0]!.id, question!.id, "the answer doesn't change which question it is");
  assert.equal(check("tasks.md", answered), undefined);
  assert.equal(withAnswer(TASKS, "nope", "x", "2026-11-26"), undefined);

  const many = EMPTY_TASKS + Array.from({ length: 35 }, (_, i) => `- 2026-10-${String(i + 1).padStart(2, "0")}: Did thing ${i + 1}.`).join("\n") + "\n";
  const trimmed = trimDone(many, 30);
  assert.equal(trimmed.match(/^- 2026/gm)!.length, 30);
  assert.ok(!trimmed.includes("Did thing 5.") && trimmed.includes("Did thing 6.") && trimmed.includes("Did thing 35."));
  assert.equal(trimDone(TASKS, 30), TASKS);
});

test("mind: an edit is previewed only when its replacements apply exactly", () => {
  assert.equal(edited("a b c", { edits: [{ oldText: "b", newText: "B" }, { oldText: "a", newText: "A" }] }), "A B c");
  assert.equal(edited("a b c", { oldText: "b", newText: "" }), "a  c");
  assert.equal(edited("a a", { edits: [{ oldText: "a", newText: "b" }] }), undefined, "not unique");
  assert.equal(edited("a", { edits: [{ oldText: "z", newText: "b" }] }), undefined, "not found");
  assert.equal(edited(undefined, { edits: [{ oldText: "a", newText: "b" }] }), undefined);
});

test("mind: a fresh place is told where things go; nothing is created until something is kept", async () => {
  const f = await fixture();
  try {
    const session = await f.create();
    await f.start(session.id, "hello");
    const brief = briefOf(f.provider.requests.at(-1)!);
    assert.match(brief, /Where things go, in this order:/);
    assert.match(brief, /<notes file="\.mind\/notes\.md">\n\(Not written yet\. Look around this place first/);
    assert.match(brief, /<tasks file="\.mind\/tasks\.md">\n\(Not written yet\./);
    // Not a project agent: there is no AGENTS.md to write to, so place rules go to its own instructions.
    assert.doesNotMatch(brief, /AGENTS\.md/);
    assert.ok(brief.includes(join(f.home, "agents", "mindful", "instructions", "standing.md")), brief.slice(0, 900));
    assert.ok(brief.includes(join(f.home, "agents", "default", "instructions", "standing.md")));
    assert.match(systemOf(f.provider.requests.at(-1)!), /mind-skills[\s\S]*mind-tidy/);
    assert.ok(!existsSync(join(f.place, ".mind")));
  } finally {
    await f.cleanup();
  }
});

test("mind: writes are checked against the layout and refused with the reason; good ones are kept and can be undone", async () => {
  const f = await fixture();
  try {
    const session = await f.create();
    await f.start(session.id, call("write", { path: ".mind/notes.md", content: "# Notes\nJust some notes.\n" }));
    assert.match(sessionText(f.runtime, session.id), /Not saved\. notes\.md has exactly these sections/);
    assert.ok(!existsSync(f.file("notes.md")));
    await f.start(session.id, call("write", { path: ".mind/todo.md", content: "x" }));
    assert.match(sessionText(f.runtime, session.id), /todo\.md is not part of the layout/);
    await f.start(session.id, call("write", { path: ".mind/.state.json", content: "{}" }));
    assert.match(sessionText(f.runtime, session.id), /kept by the extension/);

    await f.start(session.id, call("write", { path: ".mind/notes.md", content: NOTES }));
    assert.equal(await f.read("notes.md"), NOTES);
    assert.match(await f.read(".gitignore"), /^\*$/m);
    await f.start(session.id, call("write", { path: ".mind/tasks.md", content: TASKS.replace(/^- \*\*Rotate.*\n/m, "") }));
    // An edit that would break the document is refused before it happens.
    await f.start(session.id, call("edit", { path: ".mind/tasks.md", edits: [{ oldText: "## Doing", newText: "## In progress" }] }));
    assert.match(await f.read("tasks.md"), /## Doing/);
    await f.start(session.id, call("edit", { path: join(f.place, ".mind", "notes.md"), edits: [{ oldText: "port 8080", newText: "port 9090" }] }));
    assert.match(await f.read("notes.md"), /port 9090/);
    await f.start(session.id, call("write", { path: ".mind/notes/nginx.md", content: "# nginx\nHow nginx is set up here and why.\n\nDetail.\n" }));
    await f.start(session.id, call("write", { path: ".mind/attachments/report.txt", content: "a report" }));

    // The view lists the changes, newest first; undoing one puts that file back.
    const view = () => f.runtime.session(session.id).extensions.views.find((v) => v.point === "session.view" && v.key === "mind")!;
    type Snapshot = { changes: { id: string; label: string; created: boolean }[]; pages: { name: string; summary: string }[]; notes: string };
    const snapshot = () => (view().props as { snapshot: Snapshot }).snapshot;
    const expected = [[".mind/attachments/report.txt", true], [".mind/notes/nginx.md", true], [".mind/notes.md", false], [".mind/tasks.md", true], [".mind/notes.md", true]];
    assert.deepEqual((await new Mind(f.place).changes()).map((c) => [c.label, c.created]), expected, "every change is kept");
    // The view shows them once its component has compiled, which can take a while on a cold machine.
    await eventually(() => !!view() && snapshot().changes.length === 5, 20_000);
    assert.deepEqual(snapshot().changes.map((c) => [c.label, c.created]), expected);
    assert.deepEqual(snapshot().pages, [{ name: "nginx", title: "nginx", summary: "How nginx is set up here and why." }]);
    assert.equal(await f.runtime.call(session.id, "session.view", "mind", "page", { name: "nginx" }), "# nginx\nHow nginx is set up here and why.\n\nDetail.\n");
    assert.equal(await f.runtime.call(session.id, "session.view", "mind", "undo", { id: snapshot().changes[2]!.id }), ".mind/notes.md");
    assert.equal(await f.read("notes.md"), NOTES);
    assert.match(snapshot().notes, /port 8080/);

    // A new session starts from what is kept.
    const next = await f.create();
    await f.start(next.id, "hello");
    const brief = briefOf(f.provider.requests.at(-1)!);
    assert.match(brief, /nginx in front of the app on port 8080\./);
    assert.match(brief, /- nginx\.md: nginx\. How nginx is set up here and why\./);
    assert.match(brief, /- Watching nginx restarts\. Next: check the logs at the next run\./);
    assert.doesNotMatch(brief, /Not written yet/);
  } finally {
    await f.cleanup();
  }
});

test("mind: what is out of place is put in front of the agent to fix", async () => {
  const f = await fixture();
  try {
    await f.put("notes.md", NOTES);
    await f.put("scratch.txt", "left by a shell command");
    await f.put("tasks.md", "## Doing\n- Something.\n");
    const session = await f.create();
    await f.start(session.id, "hello");
    const brief = briefOf(f.provider.requests.at(-1)!);
    assert.match(brief, /Fix in \.mind\/ before anything else:/);
    assert.match(brief, /\.mind\/scratch\.txt is not part of the layout/);
    assert.match(brief, /\.mind\/tasks\.md: tasks\.md has exactly these sections/);
  } finally {
    await f.cleanup();
  }
});

test("mind: the person's instructions go to the files PiSpark already loads, and a new one is selected for its agent", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.place, "AGENTS.md"), "PROJECT-RULES\n");
    const dir = await f.agent("builder", { name: "Builder", folder: f.place, resources: { extensions: ["bundled:mind"], instructions: ["local:role"] } }, { "instructions/role.md": "ROLE-TEXT\n" });
    const session = await f.runtime.create({ agent: "builder" });
    await f.start(session.id, "hello");
    const brief = briefOf(f.provider.requests.at(-1)!);
    assert.match(brief, /a rule for this project, for any agent: `AGENTS\.md`/);
    assert.ok(brief.includes(`your own instructions, \`${join(dir, "instructions", "role.md")}\``), brief.slice(0, 1200));

    // Each of those files keeps its earlier version, like the agent's own documents.
    await f.start(session.id, call("edit", { path: "AGENTS.md", edits: [{ oldText: "PROJECT-RULES", newText: "PROJECT-RULES\n- Run the browser suite before merging." }] }));
    await f.start(session.id, call("edit", { path: join(dir, "instructions", "role.md"), edits: [{ oldText: "ROLE-TEXT", newText: "ROLE-TEXT\nKeep replies short." }] }));
    const changes = await new Mind(f.place).changes();
    assert.deepEqual(changes.map((c) => c.label), ["Agent instructions: role.md", "AGENTS.md"]);

    // An agent with no instructions of its own starts one; it loads from the next session on.
    const plain = await f.create();
    const standing = join(f.home, "agents", "mindful", "instructions", "standing.md");
    await f.start(plain.id, call("write", { path: standing, content: "STANDING-RULE: say where you saved things.\n" }));
    assert.deepEqual(JSON.parse(await readFile(join(f.home, "agents", "mindful", "agent.json"), "utf8")).resources.instructions, ["local:standing"]);
    const later = await f.create();
    await f.start(later.id, "hello");
    assert.match(systemOf(f.provider.requests.at(-1)!), /STANDING-RULE: say where you saved things\./);
    assert.ok(briefOf(f.provider.requests.at(-1)!).includes(`your own instructions, \`${standing}\``));
  } finally {
    await f.cleanup();
  }
});

test("mind: a run that did work without keeping anything gets one hidden reminder; a run that kept things, or only talked, gets none", async () => {
  const f = await fixture();
  try {
    const session = await f.create();
    const reminders = () => f.provider.requests.filter((r) => /Before you finish, bring `\.mind\/` up to date/.test(lastOf(r))).length;
    await f.start(session.id, "hello there");
    assert.equal(f.provider.requests.length, 1);
    await f.start(session.id, call("write", { path: "out.txt", content: "work" }));
    await eventually(() => reminders() === 1);
    assert.match(lastOf(f.provider.requests.at(-1)!), /This place has no `\.mind\/notes\.md` yet/);
    assert.doesNotMatch(sessionText(f.runtime, session.id), /"customType":"mind-reminder"/, "the reminder isn't shown");
    const before = f.provider.requests.length;
    await f.start(session.id, call("write", { path: ".mind/notes.md", content: NOTES }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(f.provider.requests.length, before + 2, "the tool call and its follow-up only");
    assert.equal(reminders(), 1);
    // Words that read like a lasting instruction are a reason too.
    await f.start(session.id, "From now on, always run the tests before you finish.");
    await eventually(() => reminders() === 2);
  } finally {
    await f.cleanup();
  }
});

test("mind: close to compaction the agent is asked once to bring its tasks up to date, and told to reorient afterwards", async () => {
  const f = await fixture();
  try {
    await f.put("tasks.md", TASKS);
    const session = await f.create();
    const asked = () => f.provider.requests.filter((r) => /will soon be compacted/.test(lastOf(r))).length;
    await f.start(session.id, "early on");
    assert.equal(asked(), 0);
    // The model reports a context past 55% of its 100k window.
    f.provider.inputTokens = 60_000;
    await f.start(session.id, "first");
    await f.start(session.id, "later on");
    await eventually(() => asked() === 1);
    await f.start(session.id, "and later");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(asked(), 1, "once until the next compaction");
  } finally {
    await f.cleanup();
  }
});

test("mind: a question under Waiting on you doesn't stop the run; it reaches the person afterwards, once, and their answer wakes the agent", async () => {
  const f = await fixture();
  try {
    const session = await f.create();
    const dialogs = (id: string) => f.runtime.session(id).extensions.dialogs;
    await f.start(session.id, call("write", { path: ".mind/tasks.md", content: TASKS }));
    // The run is over; the question is now a card, and the session shows as waiting for the person.
    await eventually(() => dialogs(session.id).length === 1);
    const dialog = dialogs(session.id)[0]!;
    assert.equal(dialog.kind, "select");
    assert.match(JSON.stringify(dialog), /Rotate the notes password\? I recommend rotating it tonight\./);
    assert.match(JSON.stringify(dialog), /Do as recommended/);
    assert.equal(f.runtime.list().find((s) => s.id === session.id)!.waiting, true);
    assert.equal(f.runtime.session(session.id).status, "idle");

    // Another session in the same place doesn't ask again.
    const other = await f.create();
    await f.start(other.id, "hello");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(dialogs(other.id).length, 0);

    f.runtime.answer(session.id, dialog.id, "Do as recommended");
    await eventually(() => /nothing changes\.\n  - Answer \(\d{4}-\d{2}-\d{2}\): Yes, do as you recommend\./.test(readFileSync(f.file("tasks.md"), "utf8")));
    await eventually(() => f.provider.requests.some((r) => /My answer to \\"Rotate the notes password\?/.test(lastOf(r))));
    await eventually(() => f.runtime.session(session.id).status === "idle");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(dialogs(session.id).length, 0, "an answered question isn't asked again");
  } finally {
    await f.cleanup();
  }
});

test("mind: the view answers a question too, and a question can't be answered twice", async () => {
  const f = await fixture();
  try {
    await f.put("tasks.md", TASKS);
    const session = await f.create();
    await f.start(session.id, "hello");
    const view = () => f.runtime.session(session.id).extensions.views.find((v) => v.point === "session.view" && v.key === "mind")!;
    type Snapshot = { waiting: { id: string; text: string; answer?: string }[]; doing: string; done: string };
    const snapshot = () => (view().props as { snapshot: Snapshot }).snapshot;
    // The view is offered once its component has compiled.
    await eventually(() => !!view() && snapshot().waiting.length === 1, 20_000);
    assert.equal(view().title, "Mind");
    assert.match(snapshot().doing, /Watching nginx restarts/);
    assert.match(snapshot().done, /2026-11-25: Fixed the backup path/);
    // The question was put to the person when the run ended; answering in the view closes that card.
    await eventually(() => f.runtime.session(session.id).extensions.dialogs.length === 1);
    const id = snapshot().waiting[0]!.id;
    await f.runtime.call(session.id, "session.view", "mind", "answer", { id, text: "Not tonight, do it on Sunday." });
    assert.equal(snapshot().waiting[0]!.answer, "Not tonight, do it on Sunday.");
    await eventually(() => f.runtime.session(session.id).extensions.dialogs.length === 0);
    await eventually(() => f.provider.requests.some((r) => /My answer to .*Not tonight, do it on Sunday\./.test(lastOf(r))));
    const refused = (detail: RegExp) => (error: { code?: string; detail?: string }) => error.code === "extension" && detail.test(error.detail ?? "");
    await assert.rejects(f.runtime.call(session.id, "session.view", "mind", "answer", { id, text: "Again" }), refused(/already answered/));
    await assert.rejects(f.runtime.call(session.id, "session.view", "mind", "answer", { id: "nope", text: "x" }), refused(/no longer waiting/));
  } finally {
    await f.cleanup();
  }
});

test("mind: skills kept in the place load in its sessions", async () => {
  const f = await fixture();
  try {
    const session = await f.create();
    await f.start(session.id, call("write", { path: ".mind/skills/fix-backup/SKILL.md", content: "---\nname: fix-backup\ndescription: PLACE-SKILL check and repair the nightly backup on this server.\n---\nSteps\n" }));
    await f.start(session.id, call("write", { path: ".mind/skills/fix-backup/scripts/check.sh", content: "echo ok\n" }));
    assert.ok(existsSync(f.file("skills/fix-backup/scripts/check.sh")));
    const next = await f.create();
    await f.start(next.id, "hello");
    assert.match(systemOf(f.provider.requests.at(-1)!), /PLACE-SKILL check and repair the nightly backup/);
  } finally {
    await f.cleanup();
  }
});

test("mind store: Done lately is trimmed, unlinked attachments go after a week, and what is out of place is named", async () => {
  const root = await mkdtemp(join(tmpdir(), "pispark-mind-store-"));
  try {
    const m = new Mind(root);
    await m.sweep();
    assert.ok(!m.exists(), "nothing is made by looking");
    await mkdir(join(m.dir, "attachments"), { recursive: true });
    await writeFile(join(m.dir, "tasks.md"), EMPTY_TASKS + Array.from({ length: 33 }, (_, i) => `- 2026-10-${String(i + 1).padStart(2, "0")}: Thing ${i + 1}.`).join("\n") + "\n");
    await writeFile(join(m.dir, "notes.md"), NOTES + "See [the report](attachments/linked%20report.txt).\n");
    for (const name of ["old.txt", "linked report.txt", "new.txt"]) await writeFile(join(m.dir, "attachments", name), name);
    const longAgo = new Date(Date.now() - 10 * 86_400_000);
    for (const name of ["old.txt", "linked report.txt"]) await utimes(join(m.dir, "attachments", name), longAgo, longAgo);
    await writeFile(join(m.dir, "stray.txt"), "x");
    await m.sweep();
    assert.equal((await m.text("tasks.md"))!.match(/^- 2026/gm)!.length, 30);
    assert.deepEqual((await readdir(join(m.dir, "attachments"))).sort(), ["linked report.txt", "new.txt"]);
    assert.deepEqual(await m.problems(), [".mind/stray.txt is not part of the layout: move it to .mind/attachments/ or out of .mind."]);
    assert.match(await readFile(join(m.dir, ".gitignore"), "utf8"), /^\*$/m);
    // Questions already shown are remembered only while they are still waiting.
    await writeFile(join(m.dir, "tasks.md"), TASKS);
    const [question] = questions(TASKS);
    assert.deepEqual(await m.markAsked([question!.id]), [question!.id]);
    assert.deepEqual(await m.markAsked([question!.id]), []);
    await writeFile(join(m.dir, "tasks.md"), EMPTY_TASKS);
    await m.sweep();
    assert.deepEqual(await m.asked(), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mind: the Mind view compiles as PiSpark compiles extension views", async () => {
  const { compileView, viewBundle } = await import("../src/core/extensions/view-compiler.js");
  const folder = fileURLToPath(new URL("../../../plugins/extensions/mind/", import.meta.url));
  const hash = await compileView(join(folder, "Mind.svelte"), folder);
  assert.ok((viewBundle(hash) ?? "").length > 0);
});
