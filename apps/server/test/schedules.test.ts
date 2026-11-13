import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { RuntimeError } from "../src/core/runtime/errors.js";
import { SessionHttp } from "../src/http/session-http.js";
import { createAppServer } from "../src/http/server.js";
import type { Schedule } from "../src/contract/schedule-protocol.js";
import { WOKEN_ENTRY } from "../src/contract/wake-protocol.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";

const code = (expected: string) => (error: unknown) => error instanceof RuntimeError && error.code === expected;
const local = (text: string) => new Date(text).getTime();
const HOUR = 3_600_000;

/** A runtime on a clock the test moves; schedules are looked at only when the test says. */
async function fixture() {
  const h = await testHome("pispark-schedules-");
  h.provider.automatic = true;
  const clock = { now: local("2026-11-13T08:00") };
  const runtimes: SessionRuntime[] = [];
  const make = () => {
    const runtime = new SessionRuntime({ ...h.configuration, wakeTickMs: 0, now: () => clock.now });
    runtimes.push(runtime);
    return runtime;
  };
  const runtime = make();
  const folder = await h.folder("work");
  return {
    ...h,
    clock,
    runtime,
    make,
    folder,
    one: (r: SessionRuntime = runtime): Schedule => r.listSchedules().schedules[0]!,
    cleanup: async () => {
      await Promise.allSettled(runtimes.map((r) => r.shutdown()));
      await h.remove();
    },
  };
}

test("a schedule is checked, kept in its session's folder, and read again after a restart", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    for (const bad of [
      { sessionId: chat.id, prompt: "x" },
      { sessionId: chat.id, cron: "0 9 * * *", at: new Date(f.clock.now + HOUR).toISOString(), prompt: "x" },
      { sessionId: chat.id, cron: "every morning", prompt: "x" },
      { sessionId: chat.id, cron: "0 0 30 2 *", prompt: "x" },
      { sessionId: chat.id, at: new Date(f.clock.now - HOUR).toISOString(), prompt: "x" },
      { sessionId: chat.id, cron: "0 9 * * *", prompt: "  " },
      { sessionId: chat.id, cron: "0 9 * * *", prompt: "x", limit: 0 },
      { sessionId: chat.id, cron: "0 9 * * *", prompt: "x", extra: 1 },
    ])
      assert.throws(() => f.runtime.addSchedule(bad as never), code("invalid-input"));
    assert.throws(() => f.runtime.addSchedule({ sessionId: "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b", cron: "0 9 * * *", prompt: "x" }), code("not-found"));

    const added = f.runtime.addSchedule({ sessionId: chat.id, cron: "0 9 * * 1-5", prompt: "Summarise yesterday." });
    assert.equal(added.on, true);
    assert.equal(added.by, "person");
    assert.equal(added.limit, 24);
    assert.equal(added.next, new Date(local("2026-11-13T09:00")).toISOString());
    const file = JSON.parse(await readFile(join(f.home, "chats", chat.id, "schedules.json"), "utf8"));
    assert.equal(file.schedules[0].prompt, "Summarise yesterday.");
    const list = f.runtime.listSchedules();
    assert.equal(list.paused, false);
    assert.equal(list.schedules[0]!.session.persona.id, "default");

    // Changing the time starts counting from now; switching off has no next run.
    assert.equal(f.runtime.updateSchedule(added.id, { on: false }).next, undefined);
    assert.equal(f.runtime.updateSchedule(added.id, { on: true, prompt: "Changed." }).prompt, "Changed.");
    assert.throws(() => f.runtime.updateSchedule(added.id, { sessionId: chat.id } as never), code("invalid-input"));

    await f.runtime.shutdown();
    const again = f.make();
    assert.equal(f.one(again).prompt, "Changed.");
    again.removeSchedule(added.id);
    assert.deepEqual(again.listSchedules().schedules, []);
    assert.throws(() => again.removeSchedule(added.id), code("not-found"));
  } finally {
    await f.cleanup();
  }
});

test("at its time a schedule sends its prompt to its session, which says the turn was scheduled", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    await f.runtime.stop(chat.id);
    const schedule = f.runtime.addSchedule({ sessionId: chat.id, cron: "0 9 * * *", prompt: "good morning" });
    await f.runtime.checkWakes();
    assert.equal(f.provider.requests.length, 0);

    // Due: the unloaded session is loaded and the prompt sent.
    f.clock.now = local("2026-11-13T09:00:20");
    await f.runtime.checkWakes();
    await eventually(() => f.one().runs.length === 1);
    assert.equal(f.provider.requests.length, 1);
    const run = f.one().runs[0]!;
    assert.equal(run.outcome, "ran");
    assert.equal(run.due, new Date(local("2026-11-13T09:00")).toISOString());
    assert.equal(run.reason, undefined);
    assert.equal(f.one().next, new Date(local("2026-11-14T09:00")).toISOString());
    const items = f.runtime.items(chat.id, {}).items;
    const marker = items.findIndex((item) => item.customType === WOKEN_ENTRY);
    assert.ok(marker >= 0);
    assert.deepEqual(items[marker]!.details, { source: { kind: "schedule", id: schedule.id, label: "Every day at 9:00 am · Fri 13 Nov" }, due: run.due });
    assert.equal(items[marker + 1]!.role, "user");
    // The run is recorded with the wakes, beside the schedule in the session's folder.
    const wakes = JSON.parse(await readFile(join(f.home, "chats", chat.id, "wakes.json"), "utf8"));
    assert.equal(wakes.records[schedule.id][0].outcome, "ran");

    // Looking again in the same minute sends nothing more.
    await f.runtime.checkWakes();
    assert.equal(f.provider.requests.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("a run due while the session is busy waits for it, and only one waits", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    f.runtime.addSchedule({ sessionId: chat.id, cron: "*/10 * * * *", prompt: "check" });
    f.provider.automatic = false;
    const mine = f.runtime.start(chat.id, "a long task");
    await eventually(() => f.provider.active === 1);

    f.clock.now = local("2026-11-13T08:10:05");
    await f.runtime.checkWakes();
    assert.equal(f.one().waiting, true);
    f.clock.now = local("2026-11-13T08:20:05");
    await f.runtime.checkWakes();
    assert.equal(f.provider.requests.length, 1);

    // Once the chat is free the waiting run goes, without waiting for the next check.
    f.provider.automatic = true;
    f.provider.requests[0]!.release();
    await mine.completion;
    await eventually(() => f.one().runs.length === 1);
    assert.equal(f.provider.requests.length, 2);
    assert.equal(f.one().waiting, undefined);
    assert.equal(f.one().runs[0]!.reason, "busy");
    assert.equal(f.one().runs[0]!.due, new Date(local("2026-11-13T08:10")).toISOString());
    await f.runtime.checkWakes();
    assert.equal(f.provider.requests.length, 2);
  } finally {
    await f.cleanup();
  }
});

test("missed while PiSpark was off: sent once if within a day, else recorded as missed", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    f.runtime.addSchedule({ sessionId: chat.id, cron: "0 9 * * *", prompt: "daily" });
    await f.runtime.shutdown();

    // Back at 11:00 the same day: the 9:00 run is sent, late.
    f.clock.now = local("2026-11-13T11:00");
    const later = f.make();
    await later.checkWakes();
    await eventually(() => f.one(later).runs.length === 1);
    assert.equal(f.one(later).runs[0]!.reason, "off");
    assert.equal(f.provider.requests.length, 1);
    await later.shutdown();

    // Back days later: only the latest due time counts, and a weekly one is more than a day old.
    f.clock.now = local("2026-11-18T10:00");
    const much = f.make();
    much.updateSchedule(f.one(much).id, { cron: "0 9 * * 1" });
    await much.shutdown();
    f.clock.now = local("2026-11-25T10:00");
    const old = f.make();
    await old.checkWakes();
    assert.deepEqual([f.one(old).runs[0]!.outcome, f.one(old).runs[0]!.reason], ["missed", "off"]);
    assert.equal(f.provider.requests.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("the daily limit, Pause all, and archived sessions", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    f.runtime.addSchedule({ sessionId: chat.id, cron: "*/30 * * * *", prompt: "often", limit: 1 });
    f.clock.now = local("2026-11-13T08:30:01");
    await f.runtime.checkWakes();
    await eventually(() => f.one().runs.length === 1);
    f.clock.now = local("2026-11-13T09:00:01");
    await f.runtime.checkWakes();
    assert.equal(f.one().runs[0]!.outcome, "limit");
    assert.equal(f.provider.requests.length, 1);

    // The next day counts again; Pause all records runs as missed.
    f.runtime.updateSchedule(f.one().id, { limit: 5 });
    f.runtime.updateSettings({ unattendedPaused: true });
    assert.equal(f.one().next, undefined);
    f.clock.now = local("2026-11-13T09:30:01");
    await f.runtime.checkWakes();
    assert.deepEqual([f.one().runs[0]!.outcome, f.one().runs[0]!.reason], ["missed", "paused"]);
    f.runtime.updateSettings({ unattendedPaused: false });

    // Archived: held, nothing runs, nothing is caught up on restore.
    await f.runtime.archive(chat.id);
    assert.equal(f.one().held, "archived");
    assert.equal(f.one().next, undefined);
    f.clock.now = local("2026-11-13T10:00:01");
    await f.runtime.checkWakes();
    f.runtime.restore(chat.id);
    await f.runtime.checkWakes();
    assert.equal(f.provider.requests.length, 1);
    assert.equal(f.one().held, undefined);
    // Adding to an archived session is refused; deleting the session takes its schedules.
    await f.runtime.archive(chat.id);
    assert.throws(() => f.runtime.addSchedule({ sessionId: chat.id, cron: "0 9 * * *", prompt: "x" }), code("busy"));
    f.runtime.delete(chat.id);
    assert.deepEqual(f.runtime.listSchedules().schedules, []);
  } finally {
    await f.cleanup();
  }
});

test("a one-off schedule goes once it ran; Run now runs at once and is refused while busy", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    f.runtime.addSchedule({ sessionId: chat.id, at: new Date(local("2026-11-13T08:30")).toISOString(), prompt: "check back" });
    f.clock.now = local("2026-11-13T08:30:30");
    await f.runtime.checkWakes();
    await eventually(() => f.runtime.listSchedules().schedules.length === 0);
    assert.equal(f.provider.requests.length, 1);

    const daily = f.runtime.addSchedule({ sessionId: chat.id, cron: "0 9 * * *", prompt: "now please" });
    await f.runtime.runSchedule(daily.id);
    await eventually(() => f.one().runs.length === 1);
    assert.equal(f.one().runs[0]!.manual, true);
    assert.equal(f.provider.requests.length, 2);

    f.provider.automatic = false;
    const run = f.runtime.start(chat.id, "busy now");
    await eventually(() => f.provider.active === 1);
    await assert.rejects(f.runtime.runSchedule(daily.id), code("busy"));
    f.provider.automatic = true;
    f.provider.requests.at(-1)!.release();
    await run.completion;
  } finally {
    await f.cleanup();
  }
});

test("the agent's schedule tool adds to its own session only after the person says yes", async () => {
  const f = await fixture();
  try {
    const chat = await f.runtime.create({ folder: f.folder });
    const ask = async (answer: boolean) => {
      const run = f.runtime.start(chat.id, `tool:pispark_schedule:${JSON.stringify({ action: "add", cron: "0 9 * * 1-5", prompt: "digest" })}`);
      await eventually(() => f.runtime.session(chat.id).extensions.dialogs.length === 1);
      const dialog = f.runtime.session(chat.id).extensions.dialogs[0]!;
      assert.equal(dialog.kind, "confirm");
      assert.match(dialog.kind === "confirm" ? dialog.message : "", /Every weekday at 9:00 am: digest/);
      f.runtime.answer(chat.id, dialog.id, answer);
      await run.completion;
    };
    await ask(false);
    assert.deepEqual(f.runtime.listSchedules().schedules, []);
    await ask(true);
    assert.equal(f.one().by, "agent");
    assert.equal(f.one().sessionId, chat.id);
    assert.equal(f.one().prompt, "digest");
  } finally {
    await f.cleanup();
  }
});

test("schedules over HTTP: list, add, change, run now and remove", async () => {
  const f = await fixture();
  const http = new SessionHttp(f.runtime);
  const server = createAppServer({ sessions: http });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body?: unknown) =>
      fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body ?? {}) });
    const chat = await f.runtime.create({ folder: f.folder });
    const added = await post("/api/schedules", { sessionId: chat.id, cron: "0 9 * * *", prompt: "hi" });
    assert.equal(added.status, 201);
    const { id } = (await added.json()) as Schedule;
    assert.equal((await post("/api/schedules", { sessionId: chat.id, cron: "nope", prompt: "hi" })).status, 400);
    const list = await (await fetch(base + "/api/schedules")).json();
    assert.equal(list.schedules.length, 1);
    assert.equal((await (await post(`/api/schedules/${id}`, { on: false })).json()).on, false);
    assert.equal((await post(`/api/schedules/${id}/run`)).status, 202);
    await eventually(() => f.one().runs.length === 1);
    assert.equal((await post(`/api/schedules/${id}/remove`)).status, 200);
    assert.equal((await post(`/api/schedules/${id}/remove`)).status, 400);
    assert.equal(existsSync(join(f.home, "chats", chat.id, "schedules.json")), true);
  } finally {
    await http.shutdown();
    server.close();
    await f.cleanup();
  }
});
