import type { ExtensionView, Item, ItemPart } from "../../../../server/src/protocol";
import type { Json } from "../../../../server/src/stream-ops";

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
  status: "running" | "done" | "error" | "unfinished";
  result?: Item;
}

/** One thing in a response, in the order it happened. */
export type Segment =
  | { kind: "text"; key: string; text: string; size?: number; streaming: boolean; detail?: PartRef }
  | { kind: "thinking"; key: string; text: string; streaming: boolean }
  /** Consecutive tool calls, however many assistant messages they came in. */
  | { kind: "activity"; key: string; calls: ToolCall[]; live: boolean }
  /** A custom message or entry an extension renders. */
  | { kind: "custom"; key: string; item: Item }
  | { kind: "summary"; key: string; text: string }
  /** What a tool produced that is worth reading in the message itself: changes to a file ... */
  | { kind: "diff"; key: string; path?: string; patch: string }
  /** ... an image a tool returned (its bytes are read by reference) ... */
  | { kind: "image"; key: string; itemId?: string; part: number; mimeType: string; bytes: number; alt: string }
  /** ... or an SVG a tool wrote, drawn from the markup in its arguments. */
  | { kind: "svg"; key: string; markup: string; alt: string }
  | { kind: "notice"; key: string; notice: Notice }
  | { kind: "stopped"; key: string; reason: "aborted" | "error" };

/** Your message and everything the agent did and said in answer to it. */
export interface Turn {
  key: string;
  user?: Item;
  segments: Segment[];
  /** The agent is still working on this turn. */
  running: boolean;
}

const textOf = (part: ItemPart) => (part.type === "text" || part.type === "thinking" ? part.text : "");
/** The text of an item's text parts, joined. */
export const itemText = (item: Item) => item.parts.map(textOf).join("\n");
/** The first part of a finalized item that arrived clipped. */
export function clippedPart(item: Item): PartRef | undefined {
  const part = item.parts.findIndex((p) => (p.type === "text" || p.type === "thinking") && p.size !== undefined);
  return part >= 0 && item.id ? { id: item.id, part } : undefined;
}

const field = (value: Json | undefined, name: string): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value[name] : undefined;

/** Output of a finished call that reads better as part of the message than inside its activity. */
export function artifactsOf(call: ToolCall): Segment[] {
  const result = call.result;
  if (!result) return [];
  const out: Segment[] = [];
  const path = field(call.args, "path");
  const patch = field(result.details, "patch");
  if (typeof patch === "string" && patch.trim())
    out.push({ kind: "diff", key: `diff.${call.id}`, patch, path: typeof path === "string" ? path : undefined });
  result.parts.forEach((part, index) => {
    if (part.type === "image")
      out.push({ kind: "image", key: `image.${call.id}.${index}`, itemId: result.id, part: index, mimeType: part.mimeType, bytes: part.bytes, alt: `Image from ${call.name}` });
  });
  const markup = field(call.args, "content");
  if (call.name === "write" && call.status === "done" && typeof path === "string" && /\.svg$/i.test(path) && typeof markup === "string" && markup.includes("<svg"))
    out.push({ kind: "svg", key: `svg.${call.id}`, markup, alt: path });
  return out;
}

/**
 * Groups the chat's items into turns of ordered segments. Presentation only: tool results attach
 * to their call, consecutive calls merge into one activity, and extension notices land where they
 * happened. `running` says the agent is still working on the last turn.
 */
export function buildTurns(items: Item[], options: { running: boolean; notices?: Notice[] }): Turn[] {
  const results = new Map<string, Item>();
  for (const item of items) if (item.role === "toolResult" && item.callId) results.set(item.callId, item);
  const notices = [...(options.notices ?? [])].sort((a, b) => a.after - b.after || a.at - b.at);
  const turns: Turn[] = [];
  const lastItem = items.at(-1);
  let notice = 0;

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
      turns.push({ key: item.key, user: item, segments: [], running: false });
      continue;
    }
    const turn = current();
    const live = options.running && item === lastItem;
    if (item.role === "assistant") {
      item.parts.forEach((part, index) => {
        const key = `${item.key}.${index}`;
        const streaming = live && index === item.parts.length - 1;
        if (part.type === "text" && part.text.trim()) {
          emit(turn, { kind: "text", key, text: part.text, size: part.size, streaming, detail: part.size !== undefined && item.id ? { id: item.id, part: index } : undefined });
        } else if (part.type === "thinking" && part.text.trim()) {
          emit(turn, { kind: "thinking", key, text: part.text, streaming });
        } else if (part.type === "toolCall") {
          const result = results.get(part.id);
          const call: ToolCall = {
            id: part.id,
            name: part.name,
            args: part.args,
            result,
            status: result ? (result.isError ? "error" : "done") : options.running ? "running" : "unfinished",
          };
          const last = turn.segments.at(-1);
          if (last?.kind === "activity") last.calls.push(call);
          else emit(turn, { kind: "activity", key: `a.${part.id}`, calls: [call], live: false });
          // Anything worth reading follows its call; the next call then starts a new activity.
          for (const artifact of artifactsOf(call)) emit(turn, artifact);
        }
      });
      if (item.stopReason === "aborted" || item.stopReason === "error")
        emit(turn, { kind: "stopped", key: `${item.key}.stop`, reason: item.stopReason });
    } else if (item.role === "custom" || item.role === "entry") {
      emit(turn, { kind: "custom", key: item.key, item });
    } else if (item.role === "summary") {
      emit(turn, { kind: "summary", key: item.key, text: itemText(item) });
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
