import { NOTICE_ENTRY, type Item, type StyledLine } from "../../src/contract/protocol.js";
import type { SessionRuntime } from "../../src/core/runtime/session-runtime.js";

/** Everything a chat holds, as a client sees it: saved items, then what is still in flight. */
export const chatItems = (runtime: SessionRuntime, id: string): Item[] => [
  ...runtime.items(id, { limit: 100 }).items,
  ...runtime.liveDoc(id).tail,
];
/** The chat as text, to check what it contains. */
export const chatText = (runtime: SessionRuntime, id: string): string => JSON.stringify(chatItems(runtime, id));
/** What is in flight: the message being written and anything not saved yet. Empty when nothing is. */
export const inFlight = (runtime: SessionRuntime, id: string): Item[] => runtime.liveDoc(id).tail;
/** Every notice the chat shows: the ones kept in its history, then the ones shown only while it opened. */
export const chatNotices = (runtime: SessionRuntime, id: string): { kind: string; lines: StyledLine[] }[] => [
  ...chatItems(runtime, id)
    .filter((item) => item.role === "entry" && item.customType === NOTICE_ENTRY)
    .map((item) => item.details as unknown as { kind: string; lines: StyledLine[] }),
  ...runtime.session(id).extensions.notices,
];
/** A notice's text, as one line per notice. */
export const noticeText = (runtime: SessionRuntime, id: string): string[] =>
  chatNotices(runtime, id).map((notice) => notice.lines.map((line) => line.map((span) => span.text).join("")).join(" "));
