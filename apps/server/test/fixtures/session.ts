import { NOTICE_ENTRY, type Answered, type Item, type StyledLine } from "../../src/contract/protocol.js";
import type { SessionRuntime } from "../../src/core/runtime/session-runtime.js";

/** Everything a session holds, as a client sees it: saved items, then what is still in flight. */
export const sessionItems = (runtime: SessionRuntime, id: string): Item[] => [
  ...runtime.items(id, { limit: 100 }).items,
  ...runtime.liveDoc(id).tail,
];
/** The session as text, to check what it contains. */
export const sessionText = (runtime: SessionRuntime, id: string): string => JSON.stringify(sessionItems(runtime, id));
/** What is in flight: the message being written and anything not saved yet. Empty when nothing is. */
export const inFlight = (runtime: SessionRuntime, id: string): Item[] => runtime.liveDoc(id).tail;
/** Every notice the session shows: the ones kept in its history, then the ones shown only while it opened. */
export const sessionNotices = (runtime: SessionRuntime, id: string): { kind: string; lines: StyledLine[]; answered?: Answered }[] => [
  ...sessionItems(runtime, id)
    .filter((item) => item.role === "entry" && item.customType === NOTICE_ENTRY)
    .map((item) => item.details as unknown as { kind: string; lines: StyledLine[]; answered?: Answered }),
  ...runtime.session(id).extensions.notices,
];
/** A notice's text, as one line per notice. */
export const noticeText = (runtime: SessionRuntime, id: string): string[] =>
  sessionNotices(runtime, id).map((notice) => notice.lines.map((line) => line.map((span) => span.text).join("")).join(" "));
