import type {
  AdmittedPersonaSummary,
  PersonaSelection,
} from "./persona-protocol.js";
/** Client-independent v1 contract. No SDK objects, secrets, file paths, or durable event cursors. */
export interface SessionInfo {
  id: string;
  workspace: string;
  configuration: string;
  createdAt: string;
  title?: string;
  hasHistory?: boolean;
  status: string;
  interrupted: boolean;
  persona?: AdmittedPersonaSummary;
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
export interface Catalog {
  workspaces: { value: string; label: string }[];
  configurations: {
    value: string;
    label: string;
    modelSelection?: "catalog" | "fixed";
    skillReader?: boolean;
  }[];
}
export type Command = { commandId: string } & (
  | {
      type: "create";
      workspace: string;
      configuration: string;
      model?: { provider: string; id: string };
      persona?: PersonaSelection;
    }
  | { type: "open" | "cancel" | "stop"; sessionId: string }
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
