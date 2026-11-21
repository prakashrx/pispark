import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ExtensionRevisions } from "../src/core/runtime/extension-revisions.js";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { testHome } from "./fixtures/home.js";
import { eventually } from "./fixtures/local-provider.js";
import { sessionText } from "./fixtures/session.js";

const probe = (version: string) => `export default function (pi) {
  pi.registerTool({name:'revision_probe', label:'Probe', description:'Probe', parameters:{type:'object'},
    async execute(){return {content:[{type:'text', text:'probe-${version}'}]}}});
  pi.on('session_start', () => pi.events.emit('pispark:view', {
    point:'session.header', key:'revision-probe', title:'Probe', component:new URL('./Probe.svelte',import.meta.url)
  }));
}`;

test("stage, deny, reload, replace, recover and remove without changing a sibling", async () => {
  const h = await testHome();
  h.provider.automatic = true;
  await h.agent("default", { name: "Default" });
  await h.agent("no-extension-dev", { name: "No Extension Dev", off: ["tool:pispark_extension"] });
  const folder = await h.folder("checkout", { "probe/index.mjs": probe("one"), "probe/Probe.svelte": "<p>Revision probe</p>" });
  const runtime = new SessionRuntime(h.configuration);
  try {
    const { id } = await runtime.create({ folder });
    const sibling = await runtime.create({ folder });
    const plain = await runtime.create({ folder, agent: "no-extension-dev" });
    const draft = join(h.home, "sessions", id, "extension-drafts", "probe");
    await mkdir(draft, { recursive: true });
    await writeFile(join(draft, "index.mjs"), probe("one"));
    await writeFile(join(draft, "Probe.svelte"), "<p>Revision probe</p>");
    const revisions = new ExtensionRevisions(join(h.home, "sessions", id, "extension-revisions"));
    const invoke = (tool: string, args: object, session = id) => runtime.start(session, `tool:${tool}:${JSON.stringify(args)}`).completion;
    const stage = async () => {
      await invoke("pispark_extension", { action: "stage", name: "probe", source: "probe", scope: "session" });
      assert.ok(revisions.read().staged, sessionText(runtime, id).slice(-3000));
      return revisions.read().staged!.revision;
    };
    const reload = async (revision: string, yes: boolean) => {
      const run = invoke("pispark_extension", { action: "reload", revision });
      await eventually(() => runtime.session(id).extensions.dialogs.length === 1);
      const dialog = runtime.session(id).extensions.dialogs[0]!;
      assert.ok(dialog.kind === "confirm" && dialog.message.includes(revision));
      runtime.answer(id, dialog.id, yes);
      await run;
    };
    await invoke("pispark_extension", { action: "stage", name: "probe", source: "probe" }, plain.id);
    assert.match(sessionText(runtime, plain.id), /not found|not available/i);
    await invoke("pispark_extension", { action: "stage", name: "probe", source: "probe", scope: "project" });
    await reload(revisions.read().staged!.revision, false);
    assert.deepEqual(revisions.read().active, []);
    const one = await stage();
    await runtime.reload(id);
    assert.deepEqual(runtime.session(id).extensions.views, []);
    await writeFile(join(draft, "index.mjs"), probe("two"));
    await invoke("pispark_extension", { action: "reload", revision: one });
    await eventually(() => revisions.read().active[0]?.revision === one);
    await eventually(() => runtime.session(id).extensions.views[0]?.key === "revision-probe");
    await invoke("revision_probe", {});
    assert.match(sessionText(runtime, id), /probe-one/);
    await invoke("pispark_session", { action: "inspect" });
    assert.match(sessionText(runtime, id), /browser mounting is not verified/);
    const apply = () => invoke("pispark_extension", { action: "apply", name: "probe" });
    await apply();
    await eventually(() => !!revisions.read().active[0] && revisions.read().active[0]?.revision !== one);
    const two = revisions.read().active[0]!.revision;
    await apply();
    assert.equal(revisions.read().active[0]?.revision, two);
    assert.equal(revisions.read().staged, undefined);
    assert.deepEqual(runtime.session(id).extensions.dialogs, []);
    await invoke("revision_probe", {});
    assert.match(sessionText(runtime, id), /probe-two/);
    await writeFile(join(draft, "index.mjs"), "throw new Error('fixture import failure')");
    await apply();
    await eventually(() => revisions.read().outcome?.includes("failed (extension)") === true);
    await eventually(() => runtime.list().some((s) => s.id === id && s.status === "idle"));
    assert.equal(revisions.read().active[0]?.revision, two);
    await writeFile(join(draft, "index.mjs"), probe("bad-view"));
    await writeFile(join(draft, "Probe.svelte"), "{#each}unclosed");
    const previousFailure = revisions.read().outcome;
    await apply();
    await eventually(() => {
      const outcome = revisions.read().outcome;
      return outcome !== previousFailure && outcome?.includes("failed (extension)") === true;
    });
    await eventually(() => runtime.list().some((s) => s.id === id && s.status === "idle"));
    assert.equal(revisions.read().active[0]?.revision, two);
    await writeFile(join(draft, "package.json"), JSON.stringify({ dependencies: { fixture: "1.0.0" } }));
    await apply();
    await eventually(() => revisions.read().outcome?.includes("package-lock.json") === true);
    assert.equal(revisions.read().active[0]?.revision, two);
    await invoke("pispark_extension", { action: "unload", name: "probe" });
    await eventually(() => revisions.read().active.length === 0);
    assert.deepEqual(runtime.session(id).extensions.dialogs, []);
    assert.deepEqual(runtime.session(id).extensions.views, []);
    assert.deepEqual(runtime.session(sibling.id).extensions.views, []);
    await invoke("revision_probe", {}, sibling.id);
    assert.match(sessionText(runtime, sibling.id), /not found/i);
  } finally { await runtime.shutdown(); await h.remove(); }
});

test("staging rejects paths outside the checkout and verifies copied bytes", async () => {
  const h = await testHome();
  try {
    const folder = await h.folder("checkout", { "probe.mjs": probe("one") });
    const store = new ExtensionRevisions(join(h.home, "revisions"));
    assert.throws(() => store.stage(folder, "probe", "../checkout/probe.mjs"));
    assert.throws(() => store.stage(folder, "probe", join(folder, "probe.mjs")));
    assert.throws(() => store.stage(folder, "probe"), /Only extensions installed/);
    const staged = store.stage(folder, "probe", "probe.mjs");
    store.verify(staged);
    await writeFile(store.path(staged), probe("tampered"));
    assert.throws(() => store.verify(staged), /staged files changed/);
  } finally { await h.remove(); }
});
