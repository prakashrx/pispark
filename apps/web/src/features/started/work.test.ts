import { expect, test } from "vitest";
import type { ProcessInfo } from "../../../../server/src/contract/process-protocol";
import type { Ask, SessionInfo } from "../../../../server/src/contract/protocol";
import type { ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
import { askLine, startedBy, summary, type Sources } from "./work";

const NOW = new Date("2026-11-28T10:00:00").getTime();
const session = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  folder: "/work",
  createdAt: "2026-11-28T09:00:00.000Z",
  lastActivity: "2026-11-28T09:30:00.000Z",
  title: id,
  status: "idle",
  interrupted: false,
  agent: { id: "default", name: "Default", layered: false },
  ...extra,
});
const child = (id: string, ask: Ask, extra: Partial<SessionInfo> = {}) => session(id, { parent: "parent", ask, ...extra });
const process = (id: string, sessionId: string, title: string): ProcessInfo => ({
  id,
  sessionId,
  command: "npm test",
  folder: "/work",
  title,
  startedAt: new Date(NOW - 5 * 60_000).toISOString(),
  state: "running",
  written: 0,
});
const schedule = (id: string, sessionId: string): ScheduleSummary => ({
  id,
  sessionId,
  cron: "0 9 * * 1-5",
  prompt: "digest",
  on: true,
  createdAt: "2026-11-01T00:00:00.000Z",
  by: "person",
  runs: [],
  session: { agent: { id: "default", name: "Default", layered: false } },
});

test("a child's ask in a few words: how long it has worked, what it waits for, who stopped it", () => {
  const working = child("a", { state: "working" }, { workingSince: new Date(NOW - 245_000).toISOString() });
  expect(askLine(working, NOW)).toBe("working · 4m 05s");
  expect(askLine(child("b", { state: "waiting", detail: "for tests" }), NOW)).toBe("waiting for tests");
  expect(askLine(child("c", { state: "asked", question: "A or B?" }), NOW)).toBe("has a question");
  expect(askLine(child("d", { state: "stopped", detail: "by you" }), NOW)).toBe("stopped by you");
  expect(askLine(child("e", { state: "stopped" }), NOW)).toBe("stopped");
  expect(askLine(child("f", { state: "answered" }), NOW)).toBe("answered");
  expect(askLine(session("g"), NOW)).toBe("");
});

test("everything one conversation started is one list of rows of one shape, and only its own", () => {
  const parent = session("parent", { held: { extension: "telegram", reason: "listening for messages" } });
  const from: Sources = {
    sessions: [
      parent,
      child("reviewer", { state: "working" }),
      child("writer", { state: "answered" }),
      // A fork sits under its source, but nobody asked it anything.
      session("fork", { parent: "parent", forkOf: "parent" }),
      session("other", { parent: "elsewhere", ask: { state: "working" } }),
    ],
    processes: [process("p1", "parent", "dev server"), process("p2", "elsewhere", "theirs")],
    schedules: [schedule("s1", "parent"), schedule("s2", "elsewhere")],
    paused: false,
  };
  const works = startedBy(parent, from, NOW);
  expect(works.map((work) => [work.kind, work.title, work.open])).toEqual([
    ["session", "reviewer", true],
    ["session", "writer", false],
    ["process", "dev server", true],
    ["kept", "Kept running by telegram", true],
    ["schedule", "Every weekday at 9:00 am", true],
  ]);
  expect(works.find((work) => work.kind === "process")!.detail).toBe("Running · 5 min");
  expect(works.find((work) => work.kind === "kept")!.detail).toBe("listening for messages");
  // What is open, in one line, for the strip above the message box.
  expect(summary(works.filter((work) => work.open))).toBe("1 session · 1 process · 1 schedule · kept running");
  expect(summary(startedBy(session("lonely"), from, NOW))).toBe("");
});
