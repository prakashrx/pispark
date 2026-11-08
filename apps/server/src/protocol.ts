import type { ChatPersona } from "./persona-protocol.js";
/** Client-independent v1 contract. No SDK objects, secrets, file paths, or durable event cursors. */
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
}
export interface MessageRef {
  index: number;
  key: string;
}
export interface MessagePage {
  text: string;
  next?: { part: number; offset: number };
}
export interface MessagePart {
  callId?: string;
  type: string;
  text: string;
  name?: string;
}
export interface NativeMessage {
  /** Position in Pi's context; notices and entries are placed by it. */
  index?: number;
  callId?: string;
  detail?: MessageRef;
  role: string;
  parts: MessagePart[];
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  /** An extension's own rendering of this tool result or custom message. */
  rendered?: { call?: StyledLine[]; body?: StyledLine[] };
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
export interface ExtensionView {
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
  working?: string;
  /** Text an extension put into the reply box; apply once per id. */
  draft?: { id: string; text: string; at: number };
}
/** A custom session entry an extension renders, placed after `after` messages. */
export interface RenderedEntry {
  key: string;
  after: number;
  /** Epoch milliseconds, ordering it among notices at the same place. */
  at: number;
  lines: StyledLine[];
}
export interface SessionWindow extends SessionInfo {
  sequence: number;
  model?: { provider: string; id: string };
  messages: NativeMessage[];
  partial?: NativeMessage;
  /** Index in current native context, not a persistent history cursor. */
  before: number;
  total: number;
  truncated: boolean;
  queue: { steering: number; followUp: number };
  error?: string;
  extensions: ExtensionView;
  entries: RenderedEntry[];
}
/** Starting points for Ask's folder picker. Any existing folder on the host is allowed. */
export interface Catalog {
  home: string;
  recentFolders: string[];
}
export type Command = { commandId: string } & (
  | {
      type: "create";
      /** Absolute path of an existing folder on the backend host. */
      folder: string;
      model?: { provider: string; id: string };
      /** Persona ID; Default when omitted. */
      persona?: string;
    }
  | { type: "open" | "reload" | "cancel" | "stop"; sessionId: string }
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
export interface SnapshotEvent {
  type: "snapshot";
  boundary: "initial" | "update";
  sessionId: string;
  sequence: number;
  snapshot: SessionWindow;
}
export interface ProtocolError {
  error: string;
  commandId?: string;
}
