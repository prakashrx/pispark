import { validReportMode, type ReportMode } from "../../contract/wake-protocol.js";

/** The built-in extension's tool for running commands in the background. */
export const PROCESS_TOOL = "pispark_process";
/** How the tool (or an extension in the same session) reaches the host, on the session's bus. */
export const PROCESS_CHANNEL = "pispark:process-request";

/** A wait always has a time limit (owner, 2026-11-14): `waitFor` comes with `timeoutSeconds`. */
export interface Wait {
  /** A regular expression the output should show, such as "ready|listening on". */
  waitFor: string;
  timeoutSeconds: number;
}
export type ProcessRequest =
  | ({ action: "start"; command: string; folder?: string; title?: string; report?: ReportMode; stopAfterSeconds?: number } & Partial<Wait>)
  | { action: "list" }
  | ({ action: "output"; id: string } & Partial<Wait>)
  | { action: "watch"; id: string; pattern: string; report?: ReportMode }
  | { action: "unwatch"; id: string; pattern: string }
  | { action: "stop"; id: string };
export interface ProcessMessage {
  request: ProcessRequest;
  reply: (answer: { ok: boolean; text: string }) => void;
  /** Ends a wait early, such as when the agent's turn is cancelled. */
  signal?: AbortSignal;
  taken?: boolean;
}

const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const seconds = (value: unknown, max: number) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max;

export function validProcessMessage(value: unknown): value is ProcessMessage {
  const message = value as ProcessMessage;
  if (!message || typeof message !== "object" || typeof message.reply !== "function") return false;
  const r = message.request as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return false;
  // A wait names what to wait for and for how long, together.
  const wait = r.waitFor === undefined ? r.timeoutSeconds === undefined : text(r.waitFor, 200) && seconds(r.timeoutSeconds, 3600);
  switch (r.action) {
    case "start":
      return (
        text(r.command, 8192) &&
        (r.folder === undefined || text(r.folder, 4096)) &&
        (r.title === undefined || text(r.title, 120)) &&
        (r.report === undefined || validReportMode(r.report)) &&
        (r.stopAfterSeconds === undefined || seconds(r.stopAfterSeconds, 7 * 86_400)) &&
        wait
      );
    case "list":
      return true;
    case "output":
      return text(r.id, 64) && wait;
    case "watch":
      return text(r.id, 64) && text(r.pattern, 200) && (r.report === undefined || validReportMode(r.report));
    case "unwatch":
      return text(r.id, 64) && text(r.pattern, 200);
    case "stop":
      return text(r.id, 64);
    default:
      return false;
  }
}
