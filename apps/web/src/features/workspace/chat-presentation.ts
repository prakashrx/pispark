import type { NativeMessage, SessionInfo } from "../../../../server/src/protocol";
import { validChatTitle } from "../../../../server/src/runtime/chat-title";

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

/** Last segment of a host path, for compact labels: "D:\\dev\\pispark" → "pispark". */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}
export function chatName(chat?: SessionInfo): string {
  if (!chat) return "This chat";
  if (validChatTitle(chat.title)) return chat.title;
  if (chat.hasHistory === false) return "New chat";
  return "Untitled chat";
}
export function chatStatus(status?: string, interrupted = false): string {
  if (status === "cancelling" || status === "stopping") return "Stopping…";
  if (status === "running") return "Working…";
  if (status === "starting") return "Opening…";
  if (interrupted || status === "error") return "Needs attention";
  return "";
}

export function chatStarted(chat: SessionInfo): string {
  const date = new Date(chat.createdAt);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      });
}

export interface VisibleTurn {
  message: NativeMessage;
  /** Part indexes not worth rendering: empty text, or tool calls already settled by a later result. */
  hidden: Set<number>;
}
/**
 * Presentation-only pass over a native message window. A requested tool call is shown
 * until a later result with the same invocation ID arrives; the result then
 * carries the outcome on its own. Turns with nothing visible are dropped.
 */
export function visibleTurns(messages: NativeMessage[]): VisibleTurn[] {
  const turns = messages.map((message) => ({ message, hidden: new Set<number>() }));
  const pending = new Map<string, { turn: VisibleTurn; index: number }>();
  for (const turn of turns) {
    const { message, hidden } = turn;
    if (message.role === "toolResult") {
      const call = message.callId && pending.get(message.callId);
      if (call && message.callId) {
        call.turn.hidden.add(call.index);
        pending.delete(message.callId);
      }
      continue;
    }
    message.parts.forEach((part, index) => {
      if (part.type === "toolCall") {
        if (part.callId) pending.set(part.callId, { turn, index });
      }
      else if (!part.text?.trim()) hidden.add(index);
    });
  }
  return turns.filter(
    ({ message, hidden }) =>
      !!message.detail ||
      message.role === "toolResult" ||
      message.stopReason === "aborted" ||
      message.stopReason === "error" ||
      hidden.size < message.parts.length,
  );
}
