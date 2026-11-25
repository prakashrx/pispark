import assert from "node:assert/strict";
import { test } from "node:test";
import { realpath } from "node:fs/promises";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { CONTEXT_MESSAGE } from "../src/core/runtime/configuration.js";
import { testHome } from "./fixtures/home.js";
import { sessionText } from "./fixtures/session.js";

async function fixture() {
  const h = await testHome("pispark-builder-sessions-");
  h.provider.automatic = true;
  const runtime = new SessionRuntime(h.configuration);
  return {
    ...h,
    runtime,
    cleanup: async () => {
      await runtime.shutdown();
      await h.remove();
    },
  };
}

test("an agent has one Agent Builder session, in its folder; a fresh one puts the last away", async () => {
  const f = await fixture();
  try {
    const shop = f.runtime.agents.create({ name: "Shop" }).id;
    const first = await f.runtime.builder(shop);
    assert.equal(await f.runtime.builder(shop), first, "the same one each time");
    const listed = f.runtime.list().find((session) => session.id === first)!;
    assert.deepEqual([listed.agent.id, listed.edits], ["agent-builder", shop]);
    assert.equal(await realpath(listed.folder), await realpath(f.runtime.agents.dir({ agent: shop })));

    const second = await f.runtime.builder(shop, true);
    assert.notEqual(second, first);
    const archived = f.runtime.archived().find((session) => session.id === first)!;
    assert.equal(archived.edits, undefined, "the old one is an ordinary archived session");
    assert.equal(f.runtime.list().filter((session) => session.edits === shop).length, 1);

    // "Open as a session" lets it go: it joins the list, and the page starts another next time.
    f.runtime.release(second);
    assert.equal(f.runtime.list().find((session) => session.id === second)!.edits, undefined);
    assert.notEqual(await f.runtime.builder(shop), second);

    // Two at once still make one; and an agent's folder is no place to start a new session in.
    const other = f.runtime.agents.create({ name: "Other" }).id;
    const [a, b] = await Promise.all([f.runtime.builder(other), f.runtime.builder(other)]);
    assert.equal(a, b);
    assert.ok(!f.runtime.recentFolders().some((folder) => folder.includes(`${shop}`) || folder.includes(other)));

    // Agents the app ships can't be edited; an unknown one has none.
    await assert.rejects(f.runtime.builder("agent-builder"), { code: "agent" });
    await assert.rejects(f.runtime.builder("missing"), { code: "not-found" });
  } finally {
    await f.cleanup();
  }
});

test("deleting an agent deletes its Agent Builder sessions", async () => {
  const f = await fixture();
  try {
    const temp = f.runtime.agents.create({ name: "Temp" }).id;
    const session = await f.runtime.builder(temp);
    f.runtime.agents.remove(temp);
    await f.runtime.agentRemoved(temp);
    assert.ok(![...f.runtime.list(), ...f.runtime.archived()].some((each) => each.id === session));
  } finally {
    await f.cleanup();
  }
});

test("a note sent with a prompt reaches the model once, not shown as the person's", async () => {
  const f = await fixture();
  try {
    const folder = await f.folder("work");
    const session = await f.runtime.create({ folder });
    await f.runtime.start(session.id, "Make it shorter.", [], "Open: the skill deploy-checklist, skills/deploy-checklist/SKILL.md").completion;
    const sent = JSON.stringify(f.provider.requests[0]!.context.messages);
    assert.match(sent, /Open: the skill deploy-checklist/);
    assert.match(sent, /Make it shorter\./);
    const note = (await f.history(session.id)).find((entry) => entry.customType === CONTEXT_MESSAGE);
    assert.equal(note?.display, false);
    // The conversation shows the person's message and the reply, not the note.
    const items = JSON.parse(sessionText(f.runtime, session.id)) as { role: string; parts: { text?: string }[] }[];
    assert.deepEqual(items.map((item) => item.role), ["user", "assistant"]);
    assert.equal(items[0]!.parts[0]!.text, "Make it shorter.");

    await f.runtime.start(session.id, "Thanks.").completion;
    const later = f.provider.requests.at(-1)!.context.messages.filter((m) => m.role !== "assistant" && JSON.stringify(m).includes("Open: the skill"));
    assert.equal(later.length, 1, "kept in the history once, not sent again as new");
  } finally {
    await f.cleanup();
  }
});
