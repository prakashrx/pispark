/**
 * What a session started, as rows: a child session, a process, a schedule and "kept running"
 * share one shape, so the "Started here" panel, the strip above the message box and Background
 * all draw the same row (design: the conversation owns its work).
 */
import { describeSchedule } from "../../../../server/src/contract/cron";
import type { ProcessInfo } from "../../../../server/src/contract/process-protocol";
import type { Ask, SessionInfo } from "../../../../server/src/contract/protocol";
import type { ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
import { processName, processState } from "../background/process-presentation";
import { nextText } from "../schedules/schedule-presentation";
import { elapsed, sessionName } from "../workspace/session-presentation";

export type WorkKind = "session" | "process" | "schedule" | "kept";

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
  /** The conversation it belongs to. */
  owner: SessionInfo;
  /** A schedule, for its switch and its form. */
  schedule?: ScheduleSummary;
}

/** What the rows are made from: the lists every client already reads. */
export interface Sources {
  sessions: SessionInfo[];
  /** The processes still running, of any session. */
  processes: ProcessInfo[];
  schedules: ScheduleSummary[];
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

/** Everything one conversation started, of every kind: its children first, then what runs for it. */
export function startedBy(owner: SessionInfo, from: Sources, now: number): Work[] {
  return [
    ...from.sessions
      .filter((s) => s.parent === owner.id && s.ask)
      .map((s): Work => ({ key: `session:${s.id}`, kind: "session", ref: s.id, title: sessionName(s), detail: askLine(s, now), state: s.ask!.state, open: OPEN.includes(s.ask!.state), owner })),
    ...from.processes
      .filter((p) => p.sessionId === owner.id)
      .map((p): Work => ({ key: `process:${p.id}`, kind: "process", ref: p.id, title: processName(p), detail: processState(p, now), open: true, owner })),
    ...(owner.held ? [{ key: `kept:${owner.id}`, kind: "kept", ref: owner.id, title: `Kept running by ${owner.held.extension}`, detail: owner.held.reason, open: true, owner } satisfies Work] : []),
    ...from.schedules
      .filter((x) => x.sessionId === owner.id)
      .map((x): Work => ({ key: `schedule:${x.id}`, kind: "schedule", ref: x.id, title: describeSchedule(x), detail: nextText(x, from.paused, new Date(now)), open: true, owner, schedule: x })),
  ];
}

const NAMES: Record<WorkKind, [string, string]> = {
  session: ["session", "sessions"],
  process: ["process", "processes"],
  schedule: ["schedule", "schedules"],
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
export const sourcesOf = (client: { sessions: SessionInfo[]; processes: { running: ProcessInfo[] }; schedules: { schedules: ScheduleSummary[]; paused: boolean } }): Sources => ({
  sessions: client.sessions,
  processes: client.processes.running,
  schedules: client.schedules.schedules,
  paused: client.schedules.paused,
});
