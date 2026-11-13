import type { ScheduleInput } from "../../contract/schedule-protocol.js";

/** The built-in extension's schedule tool; no persona extension may register the same name. */
export const SCHEDULE_TOOL = "pispark_schedule";
/**
 * How the built-in tool reaches the host, on the session's own event bus. Not an extension API: the
 * host asks the person before anything is added, whoever sent the request.
 */
export const SCHEDULE_CHANNEL = "pispark:schedule-request";

export type ScheduleRequest =
  | { action: "list" }
  | { action: "add"; input: ScheduleInput }
  | { action: "remove"; id: string };
/** What the bus carries: the request, and where its answer goes (text for the agent). */
export interface ScheduleMessage {
  request: ScheduleRequest;
  reply: (answer: { ok: boolean; text: string }) => void;
  /** Set by the host while the event is delivered. */
  taken?: boolean;
}

export function validMessage(value: unknown): value is ScheduleMessage {
  const message = value as ScheduleMessage;
  if (!message || typeof message !== "object" || typeof message.reply !== "function") return false;
  const request = message.request as Record<string, unknown> | undefined;
  if (!request || typeof request !== "object") return false;
  if (request.action === "list") return true;
  if (request.action === "remove") return typeof request.id === "string" && request.id.length <= 64;
  return request.action === "add" && !!request.input && typeof request.input === "object";
}
