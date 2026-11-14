import { validReportMode, type ReportMode } from "../../contract/wake-protocol.js";

/** The built-in extension's tool for starting and following child sessions. */
export const SESSION_TOOL = "pispark_session";
/** The tool a child in status mode has, to raise something its parent needs to act on. */
export const REPORT_TOOL = "pispark_report";
/**
 * How the built-in tools reach the host, on the session's own event bus. An extension in the same
 * session may send the same request; it has the same rights: this session's own children only.
 */
export const SESSION_CHANNEL = "pispark:session-request";
/**
 * An extension in a child session sets the data its result carries (JSON, at most 64 KiB), such
 * as what its own tool collected: `pi.events.emit(RESULT_CHANNEL, { data })`. The last one counts.
 */
export const RESULT_CHANNEL = "pispark:result";
/**
 * Emitted on a parent's bus when one of its children ended or raised something, before anything
 * reaches the parent's agent. An extension may `reply({ action: "skip" })` (it handled it; the agent
 * is not woken) or `reply({ action: "send", text })` (what the agent gets instead), synchronously.
 * Without a reply the child's mode decides.
 */
export const CHILD_ENDED_CHANNEL = "pispark:child-ended";

export type SessionRequest =
  /** Start a child session with a first message; `report` says how it tells this one when it ends. */
  | { action: "start"; prompt: string; persona?: string; title?: string; report?: ReportMode }
  | { action: "list" }
  /** Send one of its children another message. */
  | { action: "send"; id: string; text: string }
  | { action: "stop"; id: string }
  /** A child's last answer. */
  | { action: "read"; id: string }
  /** From a child in status mode: wake its parent with this. */
  | { action: "report"; text: string };
/** What the bus carries: the request, and where its answer goes (text for the agent). */
export interface SessionMessage {
  request: SessionRequest;
  reply: (answer: { ok: boolean; text: string }) => void;
  /** Set by the host while the event is delivered. */
  taken?: boolean;
}

export interface ChildEnded {
  /** The child, how it reads, and how its run ended ("finished", "stopped", "failed" or "raised"). */
  session: string;
  title: string;
  how: string;
  mode: ReportMode;
  /** Its last answer (or what it raised), and the data an extension in it set. */
  text: string;
  data?: unknown;
  reply: (answer: { action: "skip" } | { action: "send"; text: string }) => void;
}

const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;

export function validSessionMessage(value: unknown): value is SessionMessage {
  const message = value as SessionMessage;
  if (!message || typeof message !== "object" || typeof message.reply !== "function") return false;
  const request = message.request as Record<string, unknown> | undefined;
  if (!request || typeof request !== "object") return false;
  switch (request.action) {
    case "list":
      return true;
    case "start":
      return (
        text(request.prompt, 64 * 1024) &&
        (request.persona === undefined || text(request.persona, 64)) &&
        (request.title === undefined || text(request.title, 4096)) &&
        (request.report === undefined || validReportMode(request.report))
      );
    case "send":
      return text(request.id, 64) && text(request.text, 64 * 1024);
    case "report":
      return text(request.text, 64 * 1024);
    case "stop":
    case "read":
      return text(request.id, 64);
    default:
      return false;
  }
}

/** Result data an extension set: plain JSON, at most 64 KiB. */
export function validResultData(value: unknown): boolean {
  if (value === undefined) return false;
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" && Buffer.byteLength(json, "utf8") <= 64 * 1024;
  } catch {
    return false;
  }
}
