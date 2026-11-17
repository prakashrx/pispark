import type { SessionInfo } from "../../../../server/src/contract/protocol";
import type { ProcessList } from "../../../../server/src/contract/process-protocol";
import type { Routine, ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
import type { SessionAgent } from "../../../../server/src/contract/agent-protocol";
import { runFailed } from "../schedules/schedule-presentation";
import { sessionState, type SessionState } from "../workspace/session-presentation";

type RunningProcess = ProcessList["processes"][number];

/** One thing that runs without you, in its owner's group (design set 5). */
export type BackgroundRow =
  | { kind: "session"; key: string; session: SessionInfo; state: Exclude<SessionState, "" | "failed" | "opening" | "stopping"> }
  | { kind: "task"; key: string; process: RunningProcess }
  | { kind: "kept"; key: string; session: SessionInfo }
  | { kind: "schedule"; key: string; schedule: ScheduleSummary }
  | { kind: "routine"; key: string; routine: Routine };

/**
 * Who a group's things belong to: a session; an app (all of its sessions, and its agent's
 * routines); an agent that isn't an app (its routines); or a session that is archived but still
 * has schedules.
 */
export type BackgroundOwner =
  | { kind: "session"; session: SessionInfo }
  | { kind: "app" | "agent"; agent: Pick<SessionAgent, "id" | "name" | "home">; folder?: string; sessions: SessionInfo[] }
  | { kind: "archived"; sessionId: string; title?: string; agent: SessionAgent };

export interface BackgroundGroup {
  key: string;
  owner: BackgroundOwner;
  rows: BackgroundRow[];
}

export type BackgroundFilter = "all" | "running" | "scheduled" | "failed";

/** A reply working, a background task or keeping a session running: something running now. */
const isRunning = (row: BackgroundRow) => row.kind === "session" || row.kind === "task" || row.kind === "kept";
/** A schedule whose last run failed. */
const isFailed = (row: BackgroundRow) => row.kind === "schedule" && !!row.schedule.runs[0] && runFailed(row.schedule.runs[0]);

const MATCHES: Record<BackgroundFilter, (row: BackgroundRow) => boolean> = {
  all: () => true,
  running: isRunning,
  scheduled: (row) => row.kind === "schedule" || row.kind === "routine",
  failed: isFailed,
};

/** Everything that runs without you, grouped by whom it belongs to. */
export function backgroundGroups(input: {
  sessions: SessionInfo[];
  schedules: ScheduleSummary[];
  routines: Routine[];
  processes: RunningProcess[];
}): BackgroundGroup[] {
  const rowsOf = (session: SessionInfo): BackgroundRow[] => {
    const state = sessionState(session);
    return [
      ...(state === "working" || state === "queued" || state === "needs-you" ? [{ kind: "session", key: `s:${session.id}`, session, state } as const] : []),
      ...input.processes.filter((p) => p.sessionId === session.id).map((process) => ({ kind: "task", key: `p:${process.id}`, process }) as const),
      ...(session.held ? [{ kind: "kept", key: `k:${session.id}`, session } as const] : []),
      ...input.schedules.filter((s) => s.sessionId === session.id).map((schedule) => ({ kind: "schedule", key: `c:${schedule.id}`, schedule }) as const),
    ];
  };

  const groups: BackgroundGroup[] = [];
  const agents = new Map<string, BackgroundGroup>();
  const agentGroup = (agent: Pick<SessionAgent, "id" | "name" | "home">) => {
    let group = agents.get(agent.id);
    if (!group) {
      group = { key: `a:${agent.id}`, owner: { kind: agent.home ? "app" : "agent", agent, sessions: [] }, rows: [] };
      agents.set(agent.id, group);
      groups.push(group);
    }
    return group;
  };

  for (const session of input.sessions) {
    const rows = rowsOf(session);
    if (session.agent.home) {
      const group = agentGroup(session.agent);
      if (group.owner.kind === "app") {
        group.owner.sessions.push(session);
        group.owner.folder ??= session.folder;
      }
      group.rows.push(...rows);
    } else if (rows.length) groups.push({ key: `s:${session.id}`, owner: { kind: "session", session }, rows });
  }
  for (const routine of input.routines) agentGroup(routine.agent).rows.push({ kind: "routine", key: `r:${routine.agent.id}:${routine.id}`, routine });

  // A schedule whose session is no longer listed belongs to an archived session.
  const listed = new Set(input.sessions.map((s) => s.id));
  for (const schedule of input.schedules) {
    if (listed.has(schedule.sessionId)) continue;
    const key = `x:${schedule.sessionId}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, owner: { kind: "archived", sessionId: schedule.sessionId, title: schedule.session.title, agent: schedule.session.agent }, rows: [] };
      groups.push(group);
    }
    group.rows.push({ kind: "schedule", key: `c:${schedule.id}`, schedule });
  }

  return groups.filter((group) => group.rows.length);
}

/** The groups with only the rows a filter shows; failed first, then running, otherwise as listed. */
export function filterGroups(groups: BackgroundGroup[], filter: BackgroundFilter): BackgroundGroup[] {
  const rank = (group: BackgroundGroup) => (group.rows.some(isFailed) ? 0 : group.rows.some(isRunning) ? 1 : 2);
  return groups
    .map((group) => ({ ...group, rows: group.rows.filter(MATCHES[filter]) }))
    .filter((group) => group.rows.length)
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group) - rank(b.group) || a.index - b.index)
    .map(({ group }) => group);
}

/** How many rows each filter shows. */
export function filterCounts(groups: BackgroundGroup[]): Record<Exclude<BackgroundFilter, "all">, number> {
  const rows = groups.flatMap((group) => group.rows);
  const count = (filter: BackgroundFilter) => rows.filter(MATCHES[filter]).length;
  return { running: count("running"), scheduled: count("scheduled"), failed: count("failed") };
}
