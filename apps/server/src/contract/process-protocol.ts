import type { ReportMode } from "./wake-protocol.js";

/**
 * A process a session started: a command that runs on the backend host beside the session, owned by
 * PiSpark rather than by the session, so it keeps running while the session unloads. Its output is
 * kept with the session (the newest 2 MB). When it ends it tells its session as `report` says.
 */
export interface ProcessInfo {
  id: string;
  sessionId: string;
  command: string;
  folder: string;
  title?: string;
  startedAt: string;
  state: "running" | "exited" | "stopped" | "failed";
  endedAt?: string;
  exitCode?: number;
  /** Why it ended besides its own exit: stopped by the person or the agent, or PiSpark stopped. */
  ended?: "stopped" | "pispark-stopped" | "timeout";
  report: ReportMode;
  /** Patterns that wake the session when a line matches. */
  watches: { pattern: string; report: ReportMode }[];
  /** Output bytes so far; reading `since` a number gives what came after it. */
  written: number;
}
/** `GET /api/sessions/:id/processes/:pid/output?since=N`: output after `since`, and where it ends. */
export interface ProcessOutput {
  text: string;
  /** Where this read ended; pass it as `since` next time. */
  next: number;
  /** Older output was cut (only the newest 2 MB is kept). */
  cut?: true;
}
/** `GET /api/processes`: every process still running, with what a list needs of its session. */
export interface ProcessList {
  processes: (ProcessInfo & { session: { title?: string } })[];
}
