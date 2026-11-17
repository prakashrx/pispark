import { expect, test } from "vitest";
import type { SessionInfo } from "../../../../server/src/contract/protocol";
import type { Routine, ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
import type { ProcessList } from "../../../../server/src/contract/process-protocol";
import { backgroundGroups, filterCounts, filterGroups } from "./background-groups";

const agent = (id: string, home?: string) => ({ id, name: id === "default" ? "Default" : id, layered: false, ...(home ? { home } : {}) });
const session = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, folder: `/work/${id}`, createdAt: "2026-11-17T00:00:00Z", status: "idle", interrupted: false, agent: agent("default"), ...extra }) as SessionInfo;
const schedule = (id: string, sessionId: string, extra: Partial<ScheduleSummary> = {}): ScheduleSummary =>
  ({ id, sessionId, cron: "0 9 * * *", prompt: "go", on: true, runs: [], session: { agent: agent("default") }, ...extra }) as ScheduleSummary;
const routine = (id: string, agentId: string, home?: string): Routine =>
  ({ id, name: id, cron: "0 8 * * 1", prompt: "plan", on: false, runs: [], agent: { id: agentId, name: agentId, ...(home ? { home } : {}) } }) as Routine;
const process = (id: string, sessionId: string) =>
  ({ id, sessionId, command: "npm run dev", folder: "/work", startedAt: "2026-11-17T00:00:00Z", state: "running", report: "status", watches: [], session: {} }) as unknown as ProcessList["processes"][number];

test("each thing sits with its owner: a session, an app with its sessions and routines, an archived session", () => {
  const groups = backgroundGroups({
    sessions: [
      session("a", { status: "running" }),
      session("b"),
      session("quiet"),
      session("desk-1", { agent: agent("desk", "home"), held: { extension: "telegram", reason: "listening" } }),
    ],
    schedules: [schedule("s1", "b"), schedule("s2", "gone", { session: { title: "Old work", agent: agent("default") } })],
    routines: [routine("morning", "desk", "home"), routine("review", "reviewer")],
    processes: [process("p1", "a")],
  });
  expect(groups.map((g) => [g.key, g.rows.map((r) => r.kind)])).toEqual([
    ["s:a", ["session", "task"]],
    ["s:b", ["schedule"]],
    ["a:desk", ["kept", "routine"]],
    ["a:reviewer", ["routine"]],
    ["x:gone", ["schedule"]],
  ]);
  expect(groups.find((g) => g.key === "a:desk")!.owner).toMatchObject({ kind: "app", folder: "/work/desk-1" });
  expect(groups.find((g) => g.key === "a:reviewer")!.owner.kind).toBe("agent");
  expect(groups.find((g) => g.key === "x:gone")!.owner).toMatchObject({ kind: "archived", title: "Old work" });
});

test("filters keep only their rows, failed and running owners first, and count what each shows", () => {
  const failed = schedule("s1", "b", { runs: [{ due: "2026-11-17T09:00:00Z", at: "2026-11-17T09:00:00Z", outcome: "failed" }] });
  const groups = backgroundGroups({
    sessions: [session("b"), session("a", { status: "running" })],
    schedules: [failed, schedule("s2", "a", { on: false })],
    routines: [],
    processes: [],
  });
  expect(filterGroups(groups, "all").map((g) => g.key)).toEqual(["s:b", "s:a"]);
  expect(filterGroups(groups, "running").map((g) => [g.key, g.rows.length])).toEqual([["s:a", 1]]);
  expect(filterGroups(groups, "failed").map((g) => g.key)).toEqual(["s:b"]);
  expect(filterCounts(groups)).toEqual({ running: 1, scheduled: 2, failed: 1 });
});
