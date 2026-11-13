/** The built-in extension's tool for starting and following child sessions. */
export const SESSION_TOOL = "pispark_session";
/**
 * How the built-in tool reaches the host, on the session's own event bus. An extension in the same
 * session may send the same request; it has the same rights: this session's own children only.
 */
export const SESSION_CHANNEL = "pispark:session-request";

export type SessionRequest =
  /** Start a child session with a first message; `report: false` keeps its answers from coming back. */
  | { action: "start"; prompt: string; persona?: string; title?: string; report?: boolean }
  | { action: "list" }
  /** Send one of its children another message. */
  | { action: "send"; id: string; text: string }
  | { action: "stop"; id: string }
  /** A child's last answer. */
  | { action: "read"; id: string };
/** What the bus carries: the request, and where its answer goes (text for the agent). */
export interface SessionMessage {
  request: SessionRequest;
  reply: (answer: { ok: boolean; text: string }) => void;
  /** Set by the host while the event is delivered. */
  taken?: boolean;
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
        (request.report === undefined || typeof request.report === "boolean")
      );
    case "send":
      return text(request.id, 64) && text(request.text, 64 * 1024);
    case "stop":
    case "read":
      return text(request.id, 64);
    default:
      return false;
  }
}
