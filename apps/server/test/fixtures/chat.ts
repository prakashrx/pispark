import type { Item } from "../../src/protocol.js";
import type { SessionRuntime } from "../../src/runtime/session-runtime.js";

/** Everything a chat holds, as a client sees it: saved items, then what is still in flight. */
export const chatItems = (runtime: SessionRuntime, id: string): Item[] => [
  ...runtime.items(id, { limit: 100 }).items,
  ...runtime.liveDoc(id).tail,
];
/** The chat as text, to check what it contains. */
export const chatText = (runtime: SessionRuntime, id: string): string => JSON.stringify(chatItems(runtime, id));
/** What is in flight: the message being written and anything not saved yet. Empty when nothing is. */
export const inFlight = (runtime: SessionRuntime, id: string): Item[] => runtime.liveDoc(id).tail;
