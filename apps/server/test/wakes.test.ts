import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wakes, type Wake, type WakeHost } from "../src/core/runtime/wakes.js";
import { RuntimeError } from "../src/core/runtime/errors.js";
import type { RunResult } from "../src/core/runtime/session.js";
import type { WokenDetails } from "../src/contract/wake-protocol.js";

const SESSION = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A host whose sessions are busy while a sent message has not been finished by the test. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pispark-wakes-"));
  await mkdir(join(root, SESSION));
  const clock = { now: new Date("2026-11-13T08:00").getTime() };
  const state = { paused: false, archived: false };
  const sent: { text: string; details: WokenDetails; finish: (result?: RunResult) => void }[] = [];
  const busy = new Set<string>();
  const host: WakeHost = {
    sessions: () => [{ id: SESSION, archived: state.archived }],
    ids: () => [SESSION],
    directory: (id) => join(root, id),
    free: (id) => !busy.has(id),
    // "skip me" stands for a wake that is settled without a message, such as one an extension took.
    settle: async (_id, { text }) => (text === "skip me" ? undefined : text),
    send: (id, text, details) => {
      if (busy.has(id)) throw new RuntimeError("busy");
      busy.add(id);
      let finish!: (result?: RunResult) => void;
      const completion = new Promise<RunResult>(
        (resolve) => (finish = (result) => (busy.delete(id), resolve(result ?? { outcome: "completed" }))),
      );
      sent.push({ text, details, finish });
      return { completion };
    },
    paused: () => state.paused,
  };
  const make = () => {
    const wakes = new Wakes(host, { now: () => clock.now });
    wakes.start();
    return wakes;
  };
  const wake = (id: string, text: string, policy: Wake["policy"]): Wake => ({
    source: { kind: "schedule", id, label: id },
    text,
    due: new Date(clock.now).toISOString(),
    policy,
  });
  return { root, clock, state, sent, busy, host, make, wake, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("a free session is sent the wake at once, with its source, and the outcome is recorded", async () => {
  const f = await fixture();
  try {
    const wakes = f.make();
    await wakes.deliver(SESSION, f.wake("a", "hello", "latest"));
    assert.equal(f.sent.length, 1);
    assert.deepEqual(f.sent[0]!.details.source, { kind: "schedule", id: "a", label: "a" });
    assert.equal(wakes.active(SESSION, "a"), true);
    f.sent[0]!.finish({ outcome: "failed", error: "execution" });
    await settle();
    assert.deepEqual(
      wakes.records(SESSION, "a").map((r) => [r.outcome, r.error]),
      [["failed", "execution"]],
    );
    assert.equal(wakes.active(SESSION, "a"), false);
  } finally {
    await f.cleanup();
  }
});

test("busy: one waiting wake stands for a latest source; a queue source waits for each, in order", async () => {
  const f = await fixture();
  try {
    const wakes = f.make();
    f.busy.add(SESSION);
    await wakes.deliver(SESSION, f.wake("clock", "tick 1", "latest"));
    await wakes.deliver(SESSION, f.wake("clock", "tick 2", "latest"));
    await wakes.deliver(SESSION, f.wake("inbox", "message 1", "queue"));
    await wakes.deliver(SESSION, f.wake("inbox", "message 2", "queue"));
    assert.equal(f.sent.length, 0);
    assert.equal(wakes.waiting(SESSION, "clock"), true);

    // Waiting wakes survive a restart.
    const again = f.make();
    f.busy.delete(SESSION);
    await again.drain();
    // Each finished run lets what waits next go: the clock's run by itself, then the messages together.
    for (let i = 0; i < 2; i++) {
      f.sent.at(-1)!.finish();
      await settle();
      await again.drain();
    }
    assert.deepEqual(
      f.sent.map((s) => s.text),
      ["tick 1", "message 1\n\nmessage 2"],
    );
    assert.equal(again.records(SESSION, "clock")[0]!.reason, "busy");
    assert.equal(again.waiting(SESSION, "inbox"), false);
    // One run for both messages, recorded for each.
    assert.deepEqual(
      again.records(SESSION, "inbox").map((record) => record.outcome),
      ["ran", "ran"],
    );
  } finally {
    await f.cleanup();
  }
});

test("Pause all: a latest wake is missed, a queue wake waits for the pause to end", async () => {
  const f = await fixture();
  try {
    const wakes = f.make();
    f.state.paused = true;
    await wakes.deliver(SESSION, f.wake("clock", "tick", "latest"));
    await wakes.deliver(SESSION, f.wake("inbox", "message", "queue"));
    await wakes.drain();
    assert.equal(f.sent.length, 0);
    assert.deepEqual([wakes.records(SESSION, "clock")[0]!.outcome, wakes.records(SESSION, "clock")[0]!.reason], ["missed", "paused"]);
    f.state.paused = false;
    await wakes.drain();
    assert.deepEqual(
      f.sent.map((s) => s.text),
      ["message"],
    );
  } finally {
    await f.cleanup();
  }
});

test("archived sessions hold waiting wakes; a queue that is full records the rest as missed", async () => {
  const f = await fixture();
  try {
    const wakes = f.make();
    f.state.archived = true;
    for (let i = 0; i < 21; i++) await wakes.deliver(SESSION, f.wake("inbox", `m${i}`, "queue"));
    await wakes.drain();
    assert.equal(f.sent.length, 0);
    assert.deepEqual([wakes.records(SESSION, "inbox")[0]!.outcome, wakes.records(SESSION, "inbox")[0]!.reason], ["missed", "full"]);
    const file = JSON.parse(await readFile(join(f.root, SESSION, "wakes.json"), "utf8"));
    assert.equal(file.waiting.length, 20);

    // Restored: the first goes; a removed source takes its waiting wakes and records with it.
    f.state.archived = false;
    await wakes.drain();
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0]!.text, /^m0\n\nm1\n\n/);
    wakes.forgetSource(SESSION, "inbox");
    f.sent[0]!.finish();
    await settle();
    assert.deepEqual(wakes.records(SESSION, "inbox"), []);
    assert.equal(wakes.waiting(SESSION, "inbox"), false);
  } finally {
    await f.cleanup();
  }
});

test("Run now is refused while the session is busy and ignores Pause all", async () => {
  const f = await fixture();
  try {
    const wakes = f.make();
    f.busy.add(SESSION);
    await assert.rejects(wakes.runNow(SESSION, f.wake("a", "now", "latest")), (e) => e instanceof RuntimeError && e.code === "busy");
    f.busy.delete(SESSION);
    f.state.paused = true;
    await wakes.runNow(SESSION, f.wake("a", "now", "latest"));
    f.sent[0]!.finish();
    await settle();
    assert.equal(wakes.records(SESSION, "a")[0]!.manual, true);
  } finally {
    await f.cleanup();
  }
});

test("everything that waited arrives together: one message, each part with its source and where it starts; what is settled without a message is left out", async () => {
  const f = await fixture();
  try {
    const wakes = f.make();
    f.busy.add(SESSION);
    const from = (id: string, text: string, start: number): Wake => ({
      ...f.wake(id, text, "queue"),
      source: { kind: "process", id, label: `${id} · exited 0` },
      card: { title: id, how: "exited 0", start },
    });
    await wakes.deliver(SESSION, from("typecheck", "typecheck exited 0. Output: clean", 28));
    await wakes.deliver(SESSION, f.wake("taken", "skip me", "queue"));
    await wakes.deliver(SESSION, from("tests", "tests exited 0. Output: 212 passed", 24));
    f.busy.delete(SESSION);
    await wakes.drain();

    assert.equal(f.sent.length, 1);
    const [{ text, details }] = f.sent as [(typeof f.sent)[number]];
    assert.equal(text, "typecheck exited 0. Output: clean\n\ntests exited 0. Output: 212 passed");
    // The first part's source and card are the message's own, as for a message of one.
    assert.equal(details.source.id, "typecheck");
    assert.deepEqual(
      details.together!.map((part) => ({ id: part.source.id, at: part.at, body: text.slice(part.at + part.card!.start).split("\n")[0] })),
      [
        { id: "typecheck", at: 0, body: "clean" },
        { id: "tests", at: 35, body: "212 passed" },
      ],
    );
    // What needed no message is recorded at once; the run is recorded for each part when it ends.
    assert.equal(wakes.records(SESSION, "taken")[0]!.outcome, "handled");
    assert.equal(wakes.waiting(SESSION), false);
    f.sent[0]!.finish();
    await settle();
    assert.deepEqual([wakes.records(SESSION, "typecheck")[0]!.outcome, wakes.records(SESSION, "tests")[0]!.outcome], ["ran", "ran"]);
  } finally {
    await f.cleanup();
  }
});
