/**
 * A wake is a session being asked to work by something other than the person at the keyboard: a
 * schedule today; another session, a webhook or an extension later. Every source is delivered the
 * same way (see `docs/session-runtime.md#wakes`); a source only decides when and what to say.
 */

/** What woke a session. `kind` and `label` are for showing; the host reads no meaning into them. */
export interface WakeSource {
  /** A schedule, another session (a parent sending its child work, a child reporting back), or a process the session started. */
  kind: "schedule" | "session" | "process";
  /** The source's own id, such as a schedule's. Records and waiting runs are kept by it. */
  id: string;
  /** How this wake reads, written by its source when it woke the session: "Every weekday at 9:00 am · Fri 13 Nov". */
  label: string;
}

/**
 * What happened to one wake. `due` is when it was due; `at` when it was sent (or found missed).
 * `started`: the run went to a new session (`session`), whose own state says how it went.
 * `handled`: an extension in the session took it, so the agent was not woken.
 */
export interface WakeRecord {
  due: string;
  at: string;
  outcome: "ran" | "failed" | "cancelled" | "missed" | "started" | "handled";
  /** The session a `started` run went to. */
  session?: string;
  /**
   * Why it was late or missed: the session was busy, PiSpark was not running, unattended runs were
   * paused, or too many were already waiting.
   */
  reason?: "busy" | "off" | "paused" | "full";
  /** Run now, from a client. */
  manual?: true;
  error?: string;
}

/**
 * A wake, kept as a custom entry of this type in Pi's session just before the message it sends, so
 * the conversation can say what woke the turn. Its item is an `entry` whose `details` are
 * `WokenDetails`.
 */
export const WOKEN_ENTRY = "pispark:woken";
export interface WokenDetails {
  source: WakeSource;
  due: string;
}

/**
 * How a session started by another one tells it when a run ends. `result`: its answer (and any data
 * an extension set) wakes the parent. `status`: a line in the parent's conversation, without a turn;
 * the child can still raise something with `pispark_report`. `none`: nothing.
 */
export const REPORT_MODES = ["result", "status", "none"] as const;
export type ReportMode = (typeof REPORT_MODES)[number];
export const validReportMode = (value: unknown): value is ReportMode => REPORT_MODES.includes(value as ReportMode);

/**
 * A status line: a custom message of this type in the parent's Pi session, stored without starting
 * a turn (the agent reads it the next time it runs). `details` are `StatusDetails`.
 */
export const STATUS_ENTRY = "pispark:status";
export interface StatusDetails {
  /** The session (or process) that ended, and how it read then. */
  session?: string;
  process?: string;
  title: string;
  /** "finished", "stopped" or "failed", or how an extension worded it. */
  how: string;
}

/** Records kept per source, newest first. */
export const MAX_RECORDS_KEPT = 10;
/** Wakes of one source waiting for a busy session, for sources whose every wake matters. */
export const MAX_WAITING_PER_SOURCE = 20;
