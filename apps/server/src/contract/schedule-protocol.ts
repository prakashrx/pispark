import type { ChatPersona } from "./persona-protocol.js";
import type { WakeRecord } from "./wake-protocol.js";

/**
 * A schedule belongs to one session and wakes it (a wake whose source is the clock): at the time, its
 * prompt is sent to that session. Exactly one of `cron` (five fields, the server's local time) and
 * `at` (one time, ISO 8601; the schedule is removed once that run is done).
 */
export interface ScheduleWhen {
  cron?: string;
  at?: string;
}
export interface Schedule extends ScheduleWhen {
  id: string;
  sessionId: string;
  prompt: string;
  on: boolean;
  /** At most this many runs a day. */
  limit: number;
  createdAt: string;
  /** Who added it: the person, or the agent (after the person said yes). */
  by: "person" | "agent";
  /** The last runs, newest first; at most ten. */
  runs: WakeRecord[];
  /** When it next runs, while it can. */
  next?: string;
  /** A run came due while the session was busy and waits for it to be free. */
  waiting?: true;
  /** It cannot run now: its session is archived. */
  held?: "archived";
}
/** A schedule with what a list needs of its session. */
export interface ScheduleSummary extends Schedule {
  session: { title?: string; persona: ChatPersona };
}
/** `GET /api/schedules`: every schedule, and whether all are paused. */
export interface ScheduleList {
  paused: boolean;
  schedules: ScheduleSummary[];
}
/** `POST /api/schedules` adds (with `sessionId`); `POST /api/schedules/:id` changes some fields. */
export interface ScheduleInput extends ScheduleWhen {
  sessionId?: string;
  prompt?: string;
  on?: boolean;
  limit?: number;
}
export const MAX_SCHEDULES_PER_SESSION = 20;
export const DEFAULT_DAILY_LIMIT = 24;
