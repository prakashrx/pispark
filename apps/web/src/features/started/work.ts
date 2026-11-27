/**
 * What a session started, as rows: a child session, a process, a schedule, a routine and "kept
 * running" share one shape, so the "Started here" panel, the strip above the message box and
 * Background all draw the same row (design: the conversation owns its work).
 */
import { describeSchedule, shortDate } from "../../../../server/src/contract/cron";
import type { ProcessInfo } from "../../../../server/src/contract/process-protocol";
import type { Ask, SessionInfo } from "../../../../server/src/contract/protocol";
import type { Routine, ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
import { processName, processState } from "../background/process-presentation";
import { nextText, runFailed } from "../schedules/schedule-presentation";
import { elapsed, sessionName } from "../workspace/session-presentation";

export type WorkKind = "session" | "process" | "schedule" | "routine" | "kept";

export interface Work {
  key: string;
  kind: WorkKind;
  /** The id of the thing itself. */
  ref: string;
  title: string;
  /** What is going on, in words. */
  detail: string;
  /** A child session: how its ask stands. */
  state?: Ask["state"];
  /** Still going or still set. What has answered, stopped or failed is not open. */
  open: boolean;
  /** The conversation it belongs to, while that is listed. A routine belongs to an agent and has none. */
  owner?: SessionInfo;
  /** Whom it belongs to, in words: its conversation's name, or a routine's agent. */
  of: string;
  /** A schedule or a routine, for its switch and what its row opens. */
  schedule?: ScheduleSummary;
  routine?: Routine;
  /** Its last run failed. */
  failed?: boolean;
}

/** What the rows are made from: the lists every client already reads. */
export interface Sources {
  sessions: SessionInfo[];
  /** The processes still running, of any session. */
  processes: ProcessInfo[];
  schedules: ScheduleSummary[];
  routines: Routine[];
  /** Schedules and routines are paused for all of PiSpark. */
  paused: boolean;
}

const OPEN: readonly Ask["state"][] = ["working", "waiting", "asked"];

/** A child's ask in a few words: "working · 4m 05s", "waiting for tests", "stopped by you". */
export function askLine(child: SessionInfo, now: number): string {
  const ask = child.ask;
  if (!ask) return "";
  if (ask.state === "working") return child.workingSince ? `working · ${elapsed(now - new Date(child.workingSince).getTime())}` : "working";
  if (ask.state === "asked") return "has a question";
  if (ask.state === "answered" || ask.state === "failed") return ask.state;
  return [ask.state, ask.detail].filter(Boolean).join(" ");
}

const scheduleRow = (x: ScheduleSummary, from: Sources, now: number, owner?: SessionInfo): Work => {
  const last = x.runs[0];
  const failed = !!last && runFailed(last);
  return {
    key: `schedule:${x.id}`,
    kind: "schedule",
    ref: x.id,
    title: describeSchedule(x),
    detail: [last ? `${failed ? "Failed" : "Ran"} ${shortDate(new Date(last.at), new Date(now))}` : "", nextText(x, from.paused, new Date(now))].filter(Boolean).join(" · "),
    open: true,
    of: owner ? sessionName(owner) : `Archived · ${x.session.title ?? "a session"}`,
    schedule: x,
    ...(owner ? { owner } : {}),
    ...(failed ? { failed } : {}),
  };
};

/** What runs for a session without being a conversation: its processes, what keeps it running, its schedules. */
function background(owner: SessionInfo, from: Sources, now: number): Work[] {
  const of = sessionName(owner);
  return [
    ...from.processes
      .filter((p) => p.sessionId === owner.id)
      .map((p): Work => ({ key: `process:${p.id}`, kind: "process", ref: p.id, title: processName(p), detail: processState(p, now), open: true, owner, of })),
    ...(owner.held ? [{ key: `kept:${owner.id}`, kind: "kept", ref: owner.id, title: `Kept running by ${owner.held.extension}`, detail: owner.held.reason, open: true, owner, of } satisfies Work] : []),
    ...from.schedules.filter((x) => x.sessionId === owner.id).map((x) => scheduleRow(x, from, now, owner)),
  ];
}

/** Everything one conversation started, of every kind: its children first, then what runs for it. */
export function startedBy(owner: SessionInfo, from: Sources, now: number): Work[] {
  const of = sessionName(owner);
  return [
    ...from.sessions
      .filter((s) => s.parent === owner.id && s.ask)
      .map((s): Work => ({ key: `session:${s.id}`, kind: "session", ref: s.id, title: sessionName(s), detail: askLine(s, now), state: s.ask!.state, open: OPEN.includes(s.ask!.state), owner, of })),
    ...background(owner, from, now),
  ];
}

/**
 * Background: the same rows for all of PiSpark. Sessions are not rows: the session list shows
 * those. A schedule whose session is no longer listed belongs to an archived session; a routine
 * belongs to its agent.
 */
export function everywhere(from: Sources, now: number): Work[] {
  const listed = new Set(from.sessions.map((s) => s.id));
  return [
    ...from.sessions.flatMap((owner) => background(owner, from, now)),
    ...from.schedules.filter((x) => !listed.has(x.sessionId)).map((x) => scheduleRow(x, from, now)),
    ...from.routines.map((routine): Work => {
      const last = routine.runs[0];
      const next = !routine.on ? "Off" : from.paused ? "Paused" : routine.next ? `Next ${shortDate(new Date(routine.next), new Date(now))}` : "On";
      return {
        key: `routine:${routine.agent.id}:${routine.id}`,
        kind: "routine",
        ref: routine.id,
        title: routine.name,
        detail: [describeSchedule({ cron: routine.cron }), last ? `Ran ${shortDate(new Date(last.due), new Date(now))}` : "", next].filter(Boolean).join(" · "),
        open: true,
        of: routine.agent.name,
        routine,
      };
    }),
  ];
}

const NAMES: Record<WorkKind, [string, string]> = {
  session: ["session", "sessions"],
  process: ["process", "processes"],
  schedule: ["schedule", "schedules"],
  routine: ["routine", "routines"],
  kept: ["kept running", "kept running"],
};

/** "2 sessions · 1 process · 1 schedule". */
export function summary(works: Work[]): string {
  return (Object.keys(NAMES) as WorkKind[])
    .map((kind) => [kind, works.filter((w) => w.kind === kind).length] as const)
    .filter(([, n]) => n)
    .map(([kind, n]) => (kind === "kept" ? NAMES.kept[0] : `${n} ${NAMES[kind][n === 1 ? 0 : 1]}`))
    .join(" · ");
}

/** The lists a client already holds, as the rows' sources. */
export const sourcesOf = (client: {
  sessions: SessionInfo[];
  processes: { running: ProcessInfo[] };
  schedules: { schedules: ScheduleSummary[]; paused: boolean };
  routines: { routines: Routine[] };
}): Sources => ({
  sessions: client.sessions,
  processes: client.processes.running,
  schedules: client.schedules.schedules,
  routines: client.routines.routines,
  paused: client.schedules.paused,
});
