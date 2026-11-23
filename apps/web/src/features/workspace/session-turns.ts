import { NOTICE_ENTRY, type ExtensionView, type Item, type ItemPart, type ReplyFailure, type StyledLine, type ToolProgress } from "../../../../server/src/contract/protocol";
import type { Json } from "../../../../server/src/contract/stream-ops";
import { STATUS_ENTRY, WOKEN_ENTRY, type WakeSource } from "../../../../server/src/contract/wake-protocol";
import { TITLE_TOOL } from "../../../../server/src/contract/session-title";
import { artifactsOf } from "./tool-views";

/** A clipped part of a finalized item, read on demand. */
export interface PartRef {
  id: string;
  part: number;
}
type Notice = ExtensionView["notices"][number];

export interface ToolCall {
  /** Pi's (opaque) call id. */
  id: string;
  name: string;
  args: Json;
  /** The call is still being written, is running, finished, failed, or never got a result. */
  /** `blocked`: an extension stopped it before it ran (Pi's `tool_call` block, a person's No). */
  status: "running" | "done" | "error" | "blocked" | "unfinished";
  result?: Item;
  /** Its arguments were cut to fit; what `args` holds is their start. */
  clipped?: true;
  /** While it runs: the end of what it has output so far. */
  progress?: ToolProgress;
}

/** One thing in a response, in the order it happened. */
export type Segment =
  | { kind: "text"; key: string; text: string; size?: number; streaming: boolean; detail?: PartRef }
  | { kind: "thinking"; key: string; text: string; streaming: boolean; /** An extension's name for collapsed thinking. */ label?: string }
  /** Consecutive tool calls, however many assistant messages they came in. */
  | { kind: "activity"; key: string; calls: ToolCall[]; live: boolean }
  /** A custom message or entry an extension renders. */
  | { kind: "custom"; key: string; item: Item }
  /**
   * Earlier messages summarized: the context's size before, and whether it happened between your
   * messages (on its own between turns) or in the middle of the work (in its turn).
   */
  | { kind: "summary"; key: string; text: string; tokensBefore?: number; between: boolean }
  /** What a tool produced that is worth reading in the message itself: changes to a file ... */
  | { kind: "diff"; key: string; path?: string; patch: string; /** The patch was cut to fit. */ clipped?: boolean }
  /** ... an image a tool returned (its bytes are read by reference) ... */
  | { kind: "image"; key: string; itemId?: string; part: number; mimeType: string; bytes: number; alt: string }
  /** ... or an SVG a tool wrote, drawn from the markup in its arguments. */
  | { kind: "svg"; key: string; markup: string; alt: string; /** The markup was cut to fit, so it is not drawn. */ clipped?: boolean }
  | { kind: "notice"; key: string; notice: Pick<Notice, "kind" | "lines"> }
  /** A tool call drawn by the component its extension placed at `item.tool:<name>`. */
  | { kind: "view"; key: string; point: string; call: ToolCall }
  /**
   * Where a reply ended early: cancelled, or failed and why (with the provider's words). `latest`:
   * the session's last reply, which Retry can follow.
   */
  | { kind: "stopped"; key: string; reason: "aborted" | ReplyFailure; error?: string; provider?: string; latest: boolean }
  /** A session this one started, shown with its live state. */
  | { kind: "session"; key: string; sessionId: string; title: string }
  /** A process this one started, shown with its live state. */
  | { kind: "process"; key: string; processId: string; title: string }
  /** A line saying something this session started ended, without a turn (status mode). */
  | { kind: "status"; key: string; title: string; how: string; session?: string; process?: string };

/** Your message and everything the agent did and said in answer to it. */
export interface Turn {
  key: string;
  user?: Item;
  /** The message was sent by something other than the person (a wake): how it reads ("Scheduled · Every day at 9:00 am · Fri 13 Nov"). */
  woken?: string;
  /** Sent by another session (which one, so the turn can link to it) or by a process it started. */
  from?: { id: string; label: string; kind: "session" | "process" | "reload" };
  segments: Segment[];
  /** The agent is still working on this turn. */
  running: boolean;
  /** Pi's entry id of the turn's last reply, saved: where a fork from this turn ends. */
  replyId?: string;
  /** When your message was recorded (epoch ms), and when the last of the response ended. */
  startedAt?: number;
  endedAt?: number;
}

const textOf = (part: ItemPart) => (part.type === "text" || part.type === "thinking" ? part.text : "");
/** The text of an item's text parts, joined. */
export const itemText = (item: Item) => item.parts.map(textOf).join("\n");
/**
 * Whether a failed tool result is a call an extension blocked before it ran: Pi words it with the
 * extension's reason ("Blocked by user") or "Tool execution was blocked".
 */
const wasBlocked = (result: Item) => /^\s*(blocked\b|tool execution was blocked)/i.test(itemText(result));
/** The first part of a finalized item that arrived clipped. */
export function clippedPart(item: Item): PartRef | undefined {
  const part = item.parts.findIndex((p) => (p.type === "text" || p.type === "thinking") && p.size !== undefined);
  return part >= 0 && item.id ? { id: item.id, part } : undefined;
}

/** The word for each source of a wake. */
const WOKEN_BY: Record<WakeSource["kind"], string> = { schedule: "Scheduled", session: "From", process: "From", reload: "From" };
/** How a turn something other than the person sent is labelled, from its `WOKEN_ENTRY` details. */
export function wokenLabel(details: unknown): string {
  const { source } = (details ?? {}) as { source?: { kind?: unknown; label?: unknown } };
  const kind = typeof source?.kind === "string" && Object.hasOwn(WOKEN_BY, source.kind) ? WOKEN_BY[source.kind as WakeSource["kind"]] : "Woken";
  const label = typeof source?.label === "string" ? source.label : "";
  if (kind === "From") return label ? `From ${label}` : "From another session";
  return [kind, label].filter(Boolean).join(" · ");
}
/** The session, process or reload a turn came from, when it was not the person or a schedule. */
export function wokenFrom(details: unknown): Turn["from"] {
  const { source } = (details ?? {}) as { source?: { kind?: unknown; id?: unknown; label?: unknown } };
  return (source?.kind === "session" || source?.kind === "process" || source?.kind === "reload") && typeof source.id === "string" && typeof source.label === "string"
    ? { id: source.id, label: source.label, kind: source.kind }
    : undefined;
}
/**
 * What a report card shows: the message without the first line the agent needs and the card already
 * says ("The session "Math" you started finished:", "The process "tests" exited 1. Last output:").
 */
export function reportBody(text: string): string {
  const session = /^The session "[^"\n]*" you started [^\n]*:\n\n/.exec(text);
  if (session) return text.slice(session[0].length);
  const process = /^The process "[^"\n]*" [^\n]*\n\nLast output:\n/.exec(text);
  return process ? text.slice(process[0].length) : text;
}

const summaryOf = (item: Item, between: boolean): Segment => ({
  kind: "summary",
  key: item.key,
  text: itemText(item),
  between,
  ...(item.tokensBefore ? { tokensBefore: item.tokensBefore } : {}),
});

/**
 * Groups the session's items into turns of ordered segments. Presentation only: tool results attach
 * to their call, consecutive calls merge into one activity, and extension notices land where they
 * happened. `running` says the agent is still working on the last turn.
 */
export function buildTurns(
  items: Item[],
  options: {
    running: boolean;
    notices?: Notice[];
    thinkingLabel?: string;
    progress?: Record<string, ToolProgress>;
    /** Whether an extension placed a component at a point (`item.tool:<name>`). */
    placed?: (point: string) => boolean;
  },
): Turn[] {
  const results = new Map<string, Item>();
  const terminal = new Set<Item>();
  let laterAssistant = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.role === "user") laterAssistant = false;
    if (item.role !== "assistant" || laterAssistant) continue;
    terminal.add(item);
    laterAssistant = true;
  }
  for (const item of items) if (item.role === "toolResult" && item.callId) results.set(item.callId, item);
  const notices = [...(options.notices ?? [])].sort((a, b) => a.after - b.after || a.at - b.at);
  const turns: Turn[] = [];
  const lastItem = items.at(-1);
  // The session's last reply, when nothing was sent after it.
  const lastAssistant = items.findLastIndex((item) => item.role === "assistant");
  const latestReply = lastAssistant >= 0 && !items.slice(lastAssistant).some((item) => item.role === "user") ? items[lastAssistant] : undefined;
  let notice = 0;
  // A summary followed by your message (or by nothing, once the work is done) happened between your
  // messages; one followed by more of the agent's work happened in the middle of it.
  const between = new Set<Item>();
  items.forEach((item, index) => {
    const next = items[index + 1];
    if (item.role === "summary" && (next ? next.role === "user" || (next.role === "entry" && next.customType === WOKEN_ENTRY) : !options.running))
      between.add(item);
  });
  /** A wake's marker, waiting for the message it sent. */
  let woken: string | undefined;
  let from: Turn["from"];

  const current = (): Turn => turns.at(-1) ?? turns[turns.push({ key: "earlier", segments: [], running: false }) - 1]!;
  const emit = (turn: Turn, segment: Segment) => turn.segments.push(segment);
  // A notice lands before the first item at or after its position. Called before a new turn starts,
  // so a notice ahead of your message ends the answer before it.
  const flush = (position: number | undefined) => {
    while (notice < notices.length && (position === undefined || notices[notice]!.after <= position)) {
      const next = notices[notice++]!;
      emit(current(), { kind: "notice", key: `n${next.id}`, notice: next });
    }
  };

  for (const item of items) {
    if (item.pos !== undefined) flush(item.pos);
    if (item.role === "user") {
      turns.push({
        key: item.key,
        user: item,
        ...(woken ? { woken } : {}),
        ...(from ? { from } : {}),
        ...(item.at ? { startedAt: item.at } : {}),
        segments: [],
        running: false,
      });
      woken = undefined;
      from = undefined;
      continue;
    }
    if (item.role === "entry" && item.customType === WOKEN_ENTRY) {
      woken = wokenLabel(item.details);
      from = wokenFrom(item.details);
      continue;
    }
    if (item.role === "summary" && between.has(item)) {
      turns.push({ key: item.key, segments: [summaryOf(item, true)], running: false });
      continue;
    }
    const turn = current();
    const live = options.running && item === lastItem;
    // A response ends when Pi measured it ending, a tool's result when it was recorded. Lines added
    // later (an extension's note that a process stopped) are not the agent's work.
    if (item.at && (item.role === "assistant" || item.role === "toolResult")) {
      const ended = item.at + (item.role === "assistant" ? (item.durationMs ?? 0) : 0);
      if (!turn.endedAt || ended > turn.endedAt) turn.endedAt = ended;
    }
    if (item.role === "assistant") {
      if (item.id) turn.replyId = item.id;
      item.parts.forEach((part, index) => {
        const key = `${item.key}.${index}`;
        const streaming = live && index === item.parts.length - 1;
        if (part.type === "text" && part.text.trim()) {
          emit(turn, { kind: "text", key, text: part.text, size: part.size, streaming, detail: part.size !== undefined && item.id ? { id: item.id, part: index } : undefined });
        } else if (part.type === "thinking" && part.text.trim()) {
          emit(turn, { kind: "thinking", key, text: part.text, streaming, label: options.thinkingLabel });
        } else if (part.type === "toolCall") {
          const result = results.get(part.id);
          const call: ToolCall = {
            id: part.id,
            name: part.name,
            args: part.args,
            result,
            status: result ? (result.isError ? (wasBlocked(result) ? "blocked" : "error") : "done") : options.running ? "running" : "unfinished",
            ...(part.clipped ? { clipped: true as const } : {}),
            ...(!result && options.progress?.[part.id] ? { progress: options.progress[part.id] } : {}),
          };
          // Naming the session is housekeeping, not the agent's work: the title says it.
          if (call.name === TITLE_TOOL && call.status === "done") return;
          // A tool an extension placed a component for is drawn by that component alone: no activity
          // line, no default output. The next call then starts a new activity.
          const point = `item.tool:${call.name}`;
          if (options.placed?.(point)) {
            emit(turn, { kind: "view", key: `view.${call.id}`, point, call });
            return;
          }
          const last = turn.segments.at(-1);
          const artifacts = artifactsOf(call);
          // Sessions or processes started one after another make one list under one activity line.
          const rows = (segment?: Segment) => segment?.kind === "session" || segment?.kind === "process";
          let start = turn.segments.length;
          while (start > 0 && rows(turn.segments[start - 1])) start--;
          const before = turn.segments[start - 1];
          if (rows(last) && artifacts.length && artifacts.every(rows) && before?.kind === "activity" && before.calls.every((c) => c.name === call.name)) {
            before.calls.push(call);
            for (const artifact of artifacts) emit(turn, artifact);
            return;
          }
          if (last?.kind === "activity") last.calls.push(call);
          else emit(turn, { kind: "activity", key: `a.${part.id}`, calls: [call], live: false });
          // Anything worth reading follows its call; the next call then starts a new activity.
          for (const artifact of artifacts) emit(turn, artifact);
        }
      });
      // While the turn runs, a failed last reply is one Pi is retrying: the working line says so.
      if (terminal.has(item) && (item.stopReason === "aborted" || item.stopReason === "error") && !(options.running && item === lastItem))
        emit(turn, {
          kind: "stopped",
          key: `${item.key}.stop`,
          reason: item.stopReason === "aborted" ? "aborted" : (item.failure ?? "failed"),
          ...(item.error ? { error: item.error } : {}),
          ...(item.provider ? { provider: item.provider } : {}),
          latest: item === latestReply,
        });
    } else if (item.role === "custom" && item.customType === STATUS_ENTRY) {
      const d = (item.details ?? {}) as { title?: unknown; how?: unknown; session?: unknown; process?: unknown };
      emit(turn, {
        kind: "status",
        key: item.key,
        title: typeof d.title === "string" ? d.title : "It",
        how: typeof d.how === "string" ? d.how : "ended",
        ...(typeof d.session === "string" ? { session: d.session } : {}),
        ...(typeof d.process === "string" ? { process: d.process } : {}),
      });
    } else if (item.role === "entry" && item.customType === NOTICE_ENTRY) {
      // A notice the session kept in its history, where it happened.
      const saved = (item.details ?? {}) as { kind?: Notice["kind"]; lines?: StyledLine[] };
      emit(turn, { kind: "notice", key: item.key, notice: { kind: saved.kind ?? "info", lines: Array.isArray(saved.lines) ? saved.lines : [] } });
    } else if (item.role === "custom" || item.role === "entry") {
      emit(turn, { kind: "custom", key: item.key, item });
    } else if (item.role === "summary") {
      emit(turn, summaryOf(item, false));
    }
  }
  flush(undefined);
  const last = turns.at(-1);
  if (last) {
    last.running = options.running;
    const tail = last.segments.at(-1);
    if (options.running && tail?.kind === "activity") tail.live = true;
  }
  return turns;
}
