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
  callId?: string;
  detail?: MessageRef;
  role: string;
  parts: MessagePart[];
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
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
