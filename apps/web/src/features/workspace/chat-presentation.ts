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
 * Presentation-only pass over a native message window. A tool call is shown as
 * running until a later tool result with the same name arrives; the result then
 * carries the outcome on its own. Turns with nothing visible are dropped.
 */
export function visibleTurns(messages: NativeMessage[]): VisibleTurn[] {
  const turns = messages.map((message) => ({ message, hidden: new Set<number>() }));
  const pending: { turn: VisibleTurn; index: number; name?: string }[] = [];
  for (const turn of turns) {
    const { message, hidden } = turn;
    if (message.role === "toolResult") {
      const match = pending.findIndex((call) => call.name === message.toolName);
      const [call] = pending.splice(match >= 0 ? match : 0, 1);
      call?.turn.hidden.add(call.index);
      continue;
    }
    message.parts.forEach((part, index) => {
      if (part.type === "toolCall") pending.push({ turn, index, name: part.name });
      else if (!part.text?.trim()) hidden.add(index);
    });
  }
  return turns.filter(
    ({ message, hidden }) =>
      message.role === "toolResult" ||
      message.stopReason === "aborted" ||
      message.stopReason === "error" ||
      hidden.size < message.parts.length,
  );
}
