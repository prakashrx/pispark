import type { SessionInfo } from "../../../../server/src/contract/protocol";
import { validChatTitle } from "../../../../server/src/contract/chat-title";

export type CommandUncertaintyKind =
  | "acceptance-unknown"
  | "settlement-unknown";
export function commandUncertainty(
  kind: CommandUncertaintyKind | undefined,
  hasChat: boolean,
): string {
  const target = hasChat ? "this chat" : "your chats";
  if (kind === "acceptance-unknown")
    return `We couldn’t confirm whether that action went through. Check ${target} before trying again.`;
  if (kind === "settlement-unknown")
    return `That action may still be running. Check ${target} before trying again.`;
  return "";
}

/** What the server's code for a refused or failed command means, in words. */
const COMMAND_ERRORS: Record<string, string> = {
  folder: "That working folder doesn’t exist on the server.",
  persona: "That persona can’t be used: it is missing or can’t be resolved. Check it under Personas.",
  busy: "The chat is busy. Try again when it has finished.",
  "not-found": "That chat isn’t open on the server.",
  storage: "Couldn’t read or save on the server.",
  execution: "The run failed on the server.",
  timeout: "The server took too long to answer.",
  closed: "The server is shutting down.",
};
export const commandError = (code: string): string => COMMAND_ERRORS[code] ?? `The server could not do that (${code}).`;

/** Last segment of a host path, for compact labels: "D:\\dev\\pispark" → "pispark". */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** An app's session with no title of its own goes by the app's name. */
export const goesByApp = (session: SessionInfo): boolean => !!session.persona?.home && !validChatTitle(session.title);
export function sessionName(session?: SessionInfo): string {
  if (!session) return "This chat";
  if (validChatTitle(session.title)) return session.title;
  if (goesByApp(session)) return session.persona.name;
  if (session.hasHistory === false) return "New chat";
  return "Untitled chat";
}

/** A session's state in words, for its mark or its header; empty when there is nothing to say. */
export function sessionStatus(
  session?: Pick<SessionInfo, "status" | "interrupted" | "waiting" | "queued">,
): string {
  const status = session?.status;
  if (session?.waiting && status === "running") return "Waiting for you";
  if (session?.queued || status === "queued") return "Queued";
  if (status === "cancelling" || status === "stopping") return "Stopping…";
  if (status === "running") return "Working…";
  if (status === "starting") return "Opening…";
  if (session?.interrupted || status === "error") return "Needs attention";
  return "";
}
/** A session is put away only while nothing runs, waits or is queued in it. */
export const canArchive = (session: Pick<SessionInfo, "status" | "waiting" | "queued">): boolean =>
  ["idle", "error", "unloaded"].includes(session.status) && !session.waiting && !session.queued;
/** Of several sessions' states, the one a person most needs to see. */
export function foremostStatus(statuses: string[]): string {
  return (
    ["Needs attention", "Waiting for you", "Working…", "Queued", "Opening…", "Stopping…"].find((status) =>
      statuses.includes(status),
    ) ?? ""
  );
}

/** When a session started: "12 Nov, 9:34 pm", with the year when it is not this year's. */
export function sessionStarted(session: SessionInfo): string {
  const date = new Date(session.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
