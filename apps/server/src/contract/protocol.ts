import type { ChatPersona } from "./persona-protocol.js";
import type { DocOp, Json } from "./stream-ops.js";
/** Client-independent v2 contract. No SDK objects, secrets or file paths. */
export interface SessionInfo {
  id: string;
  /** Working folder on the backend host. */
  folder: string;
  createdAt: string;
  title?: string;
  hasHistory?: boolean;
  status: string;
  interrupted: boolean;
  persona: ChatPersona;
  /** The persona changed since this session started; reload to apply. */
  personaChanged?: boolean;
  /** An extension asked a question and the run waits for an answer. */
  waiting?: boolean;
  /** Waits for a free run slot: a prompt that has not started, or a run resuming after an answer. */
  queued?: boolean;
}
/**
 * A notice PiSpark showed in an open chat (an extension's message or failure, an answered question),
 * kept as a custom entry of this type in Pi's session so it stays where it happened. Its item is an
 * `entry` whose `details` are `{ kind, lines, at }`.
 */
export const NOTICE_ENTRY = "pispark:notice";
/**
 * One thing in the chat, projected from Pi's session: a message, a summary, or a custom entry.
 * Content keeps Pi's shape; what is large travels by reference and is read on demand.
 */
export type ItemPart =
  /** `size` is the full length when `text` was clipped. */
  | { type: "text" | "thinking"; text: string; size?: number }
  /** `args` are the parsed arguments (bounded); they grow while the model writes them. */
  | { type: "toolCall"; id: string; name: string; args: Json; clipped?: true }
  | { type: "image"; mimeType: string; bytes: number };
export interface Item {
  /** Pi's session entry id. Absent while the message is only in flight. */
  id?: string;
  /** Stable for the item's whole life, including through its commit to the session. */
  key: string;
  role: "user" | "assistant" | "toolResult" | "custom" | "summary" | "entry";
  /** Position in Pi's current context, when it has one; extension notices are placed by it. */
  pos?: number;
  parts: ItemPart[];
  stopReason?: string;
  toolName?: string;
  callId?: string;
  isError?: boolean;
  durationMs?: number;
  /** Pi's structured result for UIs (an edit's diff, an extension tool's payload); bounded. */
  details?: Json;
  /** `details` (or, for an oversized item, its tool arguments and text) were cut to fit. */
  clipped?: true;
  customType?: string;
  /** An extension's own rendering of this tool result, custom message or entry. */
  rendered?: { call?: StyledLine[]; body?: StyledLine[] };
}
/** A page of finalized items, oldest first. `head` is the session's last entry id. */
export interface ItemsPage {
  items: Item[];
  head: string | null;
  more: boolean;
}
/** One chunk of a long text part. */
export interface PartPage {
  text: string;
  next?: number;
}
/**
 * Text written for a terminal, as styled spans. Colors are PiSpark roles
 * (accent, success, warning, danger, muted, subtle, border, selected) or #rrggbb.
 */
export interface StyledSpan {
  text: string;
  fg?: string;
  bg?: string;
  bold?: true;
  dim?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  link?: string;
}
export type StyledLine = StyledSpan[];
export type ExtensionDialog = {
  id: string;
  title: string;
  /** Epoch milliseconds when the extension stops waiting. */
  expiresAt?: number;
} & (
  | { kind: "select"; options: string[] }
  | { kind: "confirm"; message: string }
  | { kind: "input"; placeholder?: string }
  | { kind: "editor"; prefill?: string }
);
/** What extensions currently show through Pi's `ctx.ui`. */
/**
 * A Svelte component an extension contributed to one of a session's points, with Pi's event bus:
 * `pi.events.emit("pispark:view", { point, key?, component?, props? })`.
 */
export interface ExtensionContribution {
  /** An item of the history (`item.tool:<name>`, `item.custom:<customType>`) or a point the client draws. */
  point: string;
  /** Tells several contributions to one point apart. */
  key: string;
  /** The compiled component (content-addressed, so a changed file gets a new url). */
  url: string;
  props?: Json;
  /** At `session.view`, a whole view of the session: its name, for the person to choose it by. */
  title?: string;
  /** How many times that view asked to be shown. A client acts on a rise it sees, never on what it finds. */
  attention?: number;
}
export interface ExtensionView {
  /** Components extensions contributed to the session's points. */
  views: ExtensionContribution[];
  dialogs: ExtensionDialog[];
  statuses: { key: string; line: StyledLine }[];
  widgets: { key: string; placement: "above" | "below"; lines: StyledLine[] }[];
  /** `after`: the number of messages that preceded the notice; `at`: epoch milliseconds. */
  notices: {
    id: number;
    kind: "info" | "warning" | "error";
    lines: StyledLine[];
    after: number;
    at: number;
  }[];
  /** The running indicator: a message, animation frames (none hides the dot), or hidden. */
  working?: { message?: string; frames?: StyledLine[]; intervalMs?: number; hidden?: true };
  /** Label for collapsed thinking. */
  thinkingLabel?: string;
  /** The window (browser tab) title; the chat title is Pi's session name. */
  title?: string;
  /** One extension header (top of the conversation) and footer (replaces the status line). */
  header?: StyledLine[];
  footer?: StyledLine[];
  /** Text an extension put into the reply box; apply once per id. */
  draft?: { id: string; text: string; at: number };
}
/** Everything about a chat except its history: status, model, queue, and what extensions show. */
export interface SessionDoc extends SessionInfo {
  model?: { provider: string; id: string };
  /** The prompt waiting for a run slot, while the chat is `queued`. */
  queuedText?: string;
  /** That prompt was waiting when PiSpark stopped, and was queued again when the chat opened. */
  restored?: true;
  queue: { steering: number; followUp: number };
  error?: string;
  extensions: ExtensionView;
  /** The commands extensions registered with Pi (`registerCommand`); sending `/name` runs one. */
  commands: SessionCommand[];
}
export interface SessionCommand {
  name: string;
  description?: string;
}
/** What a running tool has reported so far: the end of its output, and its details. */
export interface ToolProgress {
  output: string;
  details?: Json;
}
/** The live document: session state, the in-flight items and running tools. Streams as `DocOp`s. */
export interface LiveDoc {
  session: SessionDoc;
  tail: Item[];
  /** Running tool calls by (opaque) call id. Pi reports them only as events, never in its state. */
  progress: Record<string, ToolProgress>;
}
/** PiSpark's own settings. */
export interface HostSettings {
  /** How many chats may have an agent working at once; more prompts wait for a turn. */
  maxRunning: number;
  /**
   * Pause all unattended runs: nothing wakes a session but the person. A schedule's run that comes due
   * is recorded as missed; wakes whose every message matters wait for the pause to end.
   */
  unattendedPaused: boolean;
}
/** Starting points for Ask's folder picker. Any existing folder on the host is allowed. */
export interface Catalog {
  home: string;
  recentFolders: string[];
}
export type Command = { commandId: string } & (
  | {
      type: "create";
      /**
       * Absolute path of an existing folder on the backend host. Left out for a project persona,
       * which works in its own folder.
       */
      folder?: string;
      model?: { provider: string; id: string };
      /** Persona ID; Default when omitted. */
      persona?: string;
    }
  | { type: "open" | "reload" | "cancel" | "stop" | "archive" | "restore" | "delete"; sessionId: string }
  | { type: "start" | "steer" | "follow-up"; sessionId: string; text: string }
  /** Answer an extension's question; null dismisses it. */
  | {
      type: "answer";
      sessionId: string;
      dialogId: string;
      value: string | boolean | null;
    }
);
export interface Receipt {
  commandId: string;
  sessionId?: string;
  state: "accepted" | "settled";
  outcome?: "completed" | "cancelled" | "failed" | "queued" | "handled";
  error?: string;
}
/** `POST /api/sessions/:id/calls`: an extension component's `host.call(name, data)` to a function of its own placement. */
export interface CallRequest {
  point: string;
  key: string;
  name: string;
  data?: Json;
}
/** The call's answer: its result, or (with an error status) `error` and the extension's own `detail`. */
export interface CallResponse {
  result?: Json;
  error?: string;
  detail?: string;
}
/** Changes to the live document, applied in order; a `commit` moves persisted items into history. */
export type LiveOp =
  | DocOp
  | { op: "commit"; after: string | null; head: string | null; items?: Item[] };
export type LiveEvent =
  | { type: "snapshot"; sessionId: string; head: string | null; doc: LiveDoc }
  | { type: "ops"; sessionId: string; seq: number; ops: LiveOp[] }
  /** The chat is not loaded (it unloaded while idle): open it, then reconnect. */
  | { type: "unloaded"; sessionId: string };
export interface ProtocolError {
  error: string;
  commandId?: string;
}
