import type { SessionAgent, ThinkingLevel } from "./agent-protocol.js";
import type { DocOp, Json } from "./stream-ops.js";
/** What the workspace stream (`GET /api/live`) says changed; a client re-reads only those. */
export type WorkspaceArea = "sessions" | "schedules" | "routines" | "processes" | "host";
export const WORKSPACE_AREAS: readonly WorkspaceArea[] = ["sessions", "schedules", "routines", "processes", "host"];
export interface WorkspaceChange {
  type: "changed";
  areas: WorkspaceArea[];
}
/**
 * A file in a session's files folder (its artifacts): what the person attached, and what the agent
 * made for them there. `by` is unknown for a session that is not open.
 */
export interface SessionFile {
  name: string;
  size: number;
  modified: string;
  by?: "you" | "agent";
}
/** Client-independent v2 contract. No SDK objects, secrets or file paths. */
export interface SessionInfo {
  id: string;
  /** Working folder on the backend host. */
  folder: string;
  createdAt: string;
  /**
   * When it last did something: a message, a tool's result, a notice (its history's last write); when
   * it started if nothing yet. Opening or reading it doesn't count.
   */
  lastActivity: string;
  title?: string;
  hasHistory?: boolean;
  status: string;
  interrupted: boolean;
  agent: SessionAgent;
  /** The agent changed since this session started; reload to apply. */
  agentChanged?: boolean;
  /** An extension asked a question and the run waits for an answer. */
  waiting?: boolean;
  /** The waiting question's title (one line, at most 120 characters), for a nudge elsewhere. */
  question?: string;
  /** When the current reply started (ISO time), while it runs. */
  workingSince?: string;
  /** It did something since a person last looked at it (on any device). */
  unread?: boolean;
  /** Waits for a free run slot: a prompt that has not started, or a run resuming after an answer. */
  queued?: boolean;
  /** The session that started this one (a child session). */
  parent?: string;
  /** Present when the parent is the source of an independently managed manual fork. */
  forkOf?: string;
  /** The schedule or app routine this session is one run of. */
  schedule?: { id: string; due: string };
  /** Kept loaded while no one watches, by one of its extensions, and why (see `HoldRequest`). */
  held?: { extension: string; reason: string };
  /** How many processes it started are running (see `process-protocol.ts`). */
  processes?: number;
  /**
   * Open for reading only: its model (or sign-in), agent or folder can't be used, so it can't reply.
   * Its history is read from the transcript; no extension runs. Reloading tries again.
   */
  readOnly?: ReadOnlyReason;
}
export type ReadOnlyReason = "model" | "agent" | "folder";
/**
 * An extension asks on its session's Pi bus (`HOLD_CHANNEL`) to keep the session loaded while no one
 * watches, so its own live work (a bot's connection, a watcher) keeps going and starts again after a
 * restart; or lets go. Granted only if the agent allows it (`hold:<extension>`); otherwise the
 * person is asked in the session. The reply says what happened.
 */
export const HOLD_CHANNEL = "pispark:hold";
export interface HoldRequest {
  /** The asking extension's name, as its file or folder is called in the agent. */
  extension: string;
  hold: boolean;
  /** What it does while held, in a few words: "listening for Telegram messages". */
  reason?: string;
  reply?: (answer: { state: "held" | "asked" | "released" | "refused"; text: string }) => void;
}
/**
 * A notice PiSpark showed in an open session (an extension's message or failure, an answered question),
 * kept as a custom entry of this type in Pi's session so it stays where it happened. Its item is an
 * `entry` whose `details` are `{ kind, lines, at }`, plus `answered` for an answered question.
 */
export const NOTICE_ENTRY = "pispark:notice";
/**
 * A question an extension asked and what the person answered: yes or no, the option they chose, that
 * they answered (what they typed is not kept: it may be a name, a path or something private), or
 * that they skipped it.
 */
export interface Answered {
  question: string;
  said: "yes" | "no" | "chose" | "answered" | "skipped";
  /** The option chosen (`said: "chose"`). */
  choice?: string;
}
/**
 * One thing in the session, projected from Pi's session: a message, a summary, or a custom entry.
 * Content keeps Pi's shape; what is large travels by reference and is read on demand.
 */
export type ItemPart =
  /** `size` is the full length when `text` was clipped. */
  | { type: "text" | "thinking"; text: string; size?: number }
  /** `args` are the parsed arguments (bounded); they grow while the model writes them. */
  | { type: "toolCall"; id: string; name: string; args: Json; clipped?: true }
  | { type: "image"; mimeType: string; bytes: number };
/**
 * Why a model's reply failed: an exhausted usage allowance, the provider overloaded or out of reach
 * (after Pi's own retries), a conversation too long for the model, a refused sign-in, or else.
 */
export type ReplyFailure = "usage-limit" | "unavailable" | "context-full" | "signed-out" | "failed";
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
  /** Why a reply failed (`stopReason: "error"`), and the provider's own words for it, cleaned. */
  failure?: ReplyFailure;
  error?: string;
  /** The provider of a failed reply, for naming it. */
  provider?: string;
  /**
   * One of the person's messages that was edited and sent again: which version this is of how many,
   * and the entry ids of the versions before and after it (`branch` switches to one).
   */
  versions?: { at: number; of: number; previous?: string; next?: string };
  toolName?: string;
  callId?: string;
  isError?: boolean;
  /** When Pi recorded the message (epoch milliseconds): a turn's start, a response's request. */
  at?: number;
  /** How long Pi measured it took: a model response (request to end) or a tool run. */
  durationMs?: number;
  /** Pi's structured result for UIs (an edit's diff, an extension tool's payload); bounded. */
  details?: Json;
  /** A summary of earlier messages: how many tokens the context held before it. */
  tokensBefore?: number;
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
  /**
   * `after`: the number of messages that preceded the notice; `at`: epoch milliseconds. An answered
   * question is a notice with `answered` and no lines.
   */
  notices: {
    id: number;
    kind: "info" | "warning" | "error";
    lines: StyledLine[];
    answered?: Answered;
    after: number;
    at: number;
  }[];
  /** The running indicator: a message, animation frames (none hides the dot), or hidden. */
  working?: { message?: string; frames?: StyledLine[]; intervalMs?: number; hidden?: true };
  /** Label for collapsed thinking. */
  thinkingLabel?: string;
  /** The window (browser tab) title; the session title is Pi's session name. */
  title?: string;
  /** One extension header (top of the conversation) and footer (replaces the status line). */
  header?: StyledLine[];
  footer?: StyledLine[];
  /** Text an extension put into the reply box; apply once per id. */
  draft?: { id: string; text: string; at: number };
}
/** Everything about a session except its history: status, model, queue, and what extensions show. */
export interface SessionDoc extends SessionInfo {
  model?: { provider: string; id: string };
  /** The thinking level now, and the ones this model offers. */
  thinking?: { level: ThinkingLevel; levels: ThinkingLevel[] };
  /**
   * How full the model's context is: estimated tokens of the conversation it sees, of its window.
   * `tokens` and `percent` are null right after a summary, until the next reply measures it.
   */
  context?: { tokens: number | null; window: number; percent: number | null };
  /** Pi is compacting the context: asked for, before the person's next message is sent, or by itself in a run. */
  compacting?: true;
  /** The person's message waiting to be sent: for a run slot while `queued`, or while the context is compacted first. */
  queuedText?: string;
  /** That prompt was waiting when PiSpark stopped, and was queued again when the session opened. */
  restored?: true;
  queue: { steering: number; followUp: number };
  error?: string;
  extensions: ExtensionView;
  /** The commands extensions registered with Pi (`registerCommand`); sending `/name` runs one. */
  commands: SessionCommand[];
  /** The agent's prompt templates, run by typing `/name` (offered as you type `/`). */
  prompts?: SessionCommand[];
  /** An extension asked to keep this session loaded and the agent does not allow it yet. */
  holdAsked?: { extension: string; reason: string };
  /**
   * Pi is retrying a failed reply on its own: this attempt of how many, when it goes (ISO time), and
   * why the last one failed.
   */
  retrying?: { attempt: number; of: number; at: string; failure: ReplyFailure };
  /** Changes asked for while the session works, applied together once it is free (see `PendingSetup`). */
  pending?: PendingSetup;
}
/**
 * What a session will run once it is free: another model or thinking level, from the next reply on,
 * and whether it reloads (starts again from its transcript with its agent as it is then).
 */
export interface PendingSetup {
  model?: { provider: string; id: string };
  thinking?: ThinkingLevel;
  reload?: true;
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
  /** How many sessions may have an agent working at once; more prompts wait for a turn. */
  maxRunning: number;
  /**
   * Pause all unattended runs: nothing wakes a session but the person. A schedule's run that comes due
   * is recorded as missed; wakes whose every message matters wait for the pause to end.
   */
  unattendedPaused: boolean;
}
/** Starting points for the New session folder picker. Any existing folder on the host is allowed. */
export interface Catalog {
  home: string;
  recentFolders: string[];
}
export type Command = { commandId: string } & (
  | {
      type: "create";
      /**
       * Absolute path of an existing folder on the backend host. Left out for a project agent,
       * which works in its own folder.
       */
      folder?: string;
      model?: { provider: string; id: string };
      /** Agent ID; Default when omitted. */
      agent?: string;
    }
  | { type: "open" | "cancel" | "stop" | "archive" | "restore" | "delete" | "compact"; sessionId: string }
  /** A new session from this one's history: all of it, or up to and including `entryId`. */
  | { type: "fork"; sessionId: string; entryId?: string }
  /**
   * Send one of the person's messages again, edited: the conversation goes on from just before it
   * (Pi's tree navigation); what followed stays as another version.
   */
  | { type: "edit"; sessionId: string; entryId: string; text: string; attachments?: string[] }
  /** Show another version of one of the person's messages (`Item.versions`), and what followed it. */
  | { type: "branch"; sessionId: string; entryId: string }
  /**
   * Start the session again from its history, picking up agent changes; with `model`, it runs that
   * model from now on. While the session works it reloads once it is free (outcome `queued`).
   */
  | { type: "reload"; sessionId: string; model?: { provider: string; id: string } }
  /** A person names the session; it keeps that name. */
  | { type: "rename"; sessionId: string; title: string }
  /** A person looked at the session: it's read (on every device). */
  | { type: "seen"; sessionId: string }
  /** Run another model, or think more or less, from the next reply on (outcome `queued` while the session works). */
  | { type: "configure"; sessionId: string; model?: { provider: string; id: string }; thinking?: ThinkingLevel }
  /** The person answers an extension's hold request, or lets go of a hold. */
  | { type: "allow-hold" | "deny-hold" | "release-hold"; sessionId: string }
  /**
   * `attachments`: names of files uploaded to the session (`POST /api/sessions/:id/attachments`). Each is named
   * where the text places `<file name="<name>"></file>` (or at the end); images also go to the model as content.
   */
  | { type: "start" | "steer" | "follow-up"; sessionId: string; text: string; attachments?: string[] }
  /** Answer an extension's question; null dismisses it. */
  | {
      type: "answer";
      sessionId: string;
      dialogId: string;
      value: string | boolean | null;
    }
);
/** Why the server refused or failed something: the code a receipt or an error response carries. */
export type RuntimeErrorCode =
  | "invalid-input"
  | "not-found"
  | "busy"
  | "limit"
  | "configuration"
  | "model-unavailable"
  | "credentials"
  | "resources"
  | "folder"
  | "agent"
  | "storage"
  | "owned"
  | "sdk-version"
  | "unsupported"
  | "extension"
  | "usage-limit"
  | "nothing-to-compact"
  | "compaction-cancelled"
  | "execution"
  | "timeout"
  | "closed"
  /** The session is open for reading only (`SessionInfo.readOnly`). */
  | "read-only";
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
  /** The session is not loaded (it unloaded while idle): open it, then reconnect. */
  | { type: "unloaded"; sessionId: string };
export interface ProtocolError {
  error: string;
  commandId?: string;
}
