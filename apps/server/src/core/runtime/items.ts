import { createHash } from "node:crypto";
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { AgentSession, SessionEntry, SessionProjection } from "@earendil-works/pi-coding-agent";
import type { ExtensionRendering } from "../extensions/extension-render.js";
import { NOTICE_ENTRY, type Item, type ItemPart, type ItemsPage, type PartPage, type ToolProgress } from "../../contract/protocol.js";
import type { Json } from "../../contract/stream-ops.js";
import { RuntimeError } from "./errors.js";

/** Characters of one text part and of one item's text; the rest is read on demand. */
const PART_LIMIT = 128 * 1024;
const ITEM_LIMIT = 192 * 1024;
const MAX_PARTS = 64;
/** Tool arguments and details: per string, per collection, nesting, and in all. */
const STRING_LIMIT = 32 * 1024;
/** A patch or diff is what a person reads after an edit, so it may be much longer. */
const DIFF_LIMIT = 256 * 1024;
const ARGS_BUDGET = 256 * 1024;
const DETAILS_BUDGET = 512 * 1024;
/** One item, serialized, stays well inside a live frame or a history page. */
const ITEM_BYTES = 768 * 1024;
/** Everything in flight together, so a snapshot never outgrows a frame. */
const TAIL_BYTES = 768 * 1024;
/** What text keeps when an item or the tail had to shrink. */
const SHRUNK_TEXT = 16 * 1024;
/** A running tool shows the end of its output; how many are shown at once. */
const PROGRESS_OUTPUT = 8 * 1024;
const PROGRESS_DETAILS = 8 * 1024;
const MAX_RUNNING = 64;
const MAX_ENTRIES = 256;
const MAX_DEPTH = 12;
const PAGE_BYTES = 256 * 1024;
const PAGE_ITEMS = 100;
const TEXT_PAGE = 64 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

type Raw = Record<string, unknown>;

const opaque = (value: unknown): string | undefined =>
  typeof value === "string" && value
    ? createHash("sha256").update(value).digest("base64url")
    : undefined;
const label = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, 64).replace(/[\p{Cs}\p{Cc}]/gu, " ") : "";
/** Never end a clipped string in half of a surrogate pair. */
function clip(text: string, limit: number): string {
  const end = /[\uD800-\uDBFF]/.test(text.charAt(limit - 1)) ? limit - 1 : limit;
  return text.slice(0, end);
}

/** How much of a structured value may still be sent, and whether anything was cut. */
interface Bound {
  clipped: boolean;
  left: number;
}
/**
 * Pi's structured values for UIs, bounded: long strings, wide collections, deep nesting and the
 * total are cut, and `clipped` says so. The keys `patch` and `diff` at the top get a larger limit.
 */
function bound(value: unknown, flag: Bound, depth = 0, limit = STRING_LIMIT): Json {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const max = Math.max(0, Math.min(limit, flag.left));
    const kept = value.length <= max ? value : clip(value, max);
    if (kept !== value) flag.clipped = true;
    flag.left -= kept.length;
    return kept;
  }
  if (depth >= MAX_DEPTH) {
    flag.clipped = true;
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ENTRIES) flag.clipped = true;
    return value.slice(0, MAX_ENTRIES).map((item) => bound(item, flag, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Raw).filter(([, item]) => item !== undefined);
    if (entries.length > MAX_ENTRIES) flag.clipped = true;
    return Object.fromEntries(
      entries
        .slice(0, MAX_ENTRIES)
        .map(([key, item]) => [key, bound(item, flag, depth + 1, depth === 0 && (key === "patch" || key === "diff") ? DIFF_LIMIT : STRING_LIMIT)]),
    );
  }
  return null;
}

/** The raw content parts an item shows, in the order of `Item.parts`. */
function visible(content: unknown): Raw[] {
  const list: unknown[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  return list
    .filter((part): part is Raw => typeof part === "object" && part !== null && ["text", "thinking", "toolCall", "image"].includes((part as Raw).type as string))
    .slice(0, MAX_PARTS);
}

function parts(content: unknown): ItemPart[] {
  let budget = ITEM_LIMIT;
  // All of one message's tool arguments share one budget.
  let argsLeft = ARGS_BUDGET;
  return visible(content).map((part): ItemPart => {
    if (part.type === "toolCall") {
      const flag = { clipped: false, left: argsLeft };
      const args = bound(part.arguments ?? {}, flag);
      argsLeft = flag.left;
      return { type: "toolCall", id: opaque(part.id) ?? "", name: label(part.name), args, ...(flag.clipped ? { clipped: true as const } : {}) };
    }
    if (part.type === "image") {
      const mime = typeof part.mimeType === "string" && IMAGE_TYPES.has(part.mimeType) ? part.mimeType : "application/octet-stream";
      return { type: "image", mimeType: mime, bytes: typeof part.data === "string" ? Math.floor((part.data.length * 3) / 4) : 0 };
    }
    const type = part.type as "text" | "thinking";
    const text = String((type === "thinking" ? part.thinking : part.text) ?? "");
    const limit = Math.max(0, Math.min(PART_LIMIT, budget));
    budget -= Math.min(text.length, limit);
    return text.length > limit ? { type, text: clip(text, limit), size: text.length } : { type, text };
  });
}

/** Structured details, bounded; the item says when they were cut. */
function details(value: unknown): { details?: Json; clipped?: true } {
  if (value === undefined) return {};
  const flag = { clipped: false, left: DETAILS_BUDGET };
  const bounded = bound(value, flag);
  return { details: bounded, ...(flag.clipped ? { clipped: true as const } : {}) };
}

/**
 * Makes an item smaller, saying so: its details go, its tool arguments go, and its text keeps
 * only its start. The full text can still be read by reference once the item is saved.
 */
function shrink(item: Item): Item {
  const parts = item.parts.map((part): ItemPart => {
    if (part.type === "toolCall") return { ...part, args: {}, clipped: true };
    if ((part.type === "text" || part.type === "thinking") && part.text.length > SHRUNK_TEXT)
      return { ...part, text: clip(part.text, SHRUNK_TEXT), size: part.size ?? part.text.length };
    return part;
  });
  const { details: dropped, ...rest } = item;
  return { ...rest, parts, ...(dropped !== undefined ? { clipped: true as const } : {}) };
}
const size = (value: unknown) => JSON.stringify(value).length;
/**
 * What running tools reported so far (Pi's partial results, by raw call id), as the end of their
 * text output and bounded details. Ids are made opaque the same way as a tool call's.
 */
export function progressOf(running: ReadonlyMap<string, unknown>): Record<string, ToolProgress> {
  const out: Record<string, ToolProgress> = {};
  for (const [id, partial] of [...running].slice(0, MAX_RUNNING)) {
    const key = opaque(id);
    if (!key) continue;
    const raw = (partial ?? {}) as Raw;
    const text = visible(raw.content)
      .filter((part) => part.type === "text")
      .map((part) => String(part.text ?? ""))
      .join("\n");
    let output = text.length > PROGRESS_OUTPUT ? text.slice(-PROGRESS_OUTPUT) : text;
    // Never start with the second half of a surrogate pair.
    if (/^[\uDC00-\uDFFF]/.test(output)) output = output.slice(1);
    out[key] = {
      output,
      ...(raw.details === undefined ? {} : { details: bound(raw.details, { clipped: false, left: PROGRESS_DETAILS }) }),
    };
  }
  return out;
}

/** What is in flight goes out whole in every snapshot, so all of it together stays bounded. */
export const boundTail = (items: Item[]): Item[] => (size(items) > TAIL_BYTES ? items.map(shrink) : items);
/** An item never outgrows what one frame can carry. */
const fit = (item: Item): Item => (size(item) > ITEM_BYTES ? shrink(item) : item);

/**
 * Projects Pi's session into the chat's items. Pi is the only store: history is read from its
 * entries, and the in-flight tail from the agent state that has not been persisted yet.
 */
export class ItemProjector {
  private readonly keys = new WeakMap<object, string>();
  private counter = 0;
  /**
   * Key of the message that was streaming at the last tick. Pi hands over a different object when
   * it finishes, so the last assistant message to arrive takes this key over; the UI never remounts.
   */
  private streamKey?: string;
  private cache?: { leaf: string | null; projection: SessionProjection; starts: Map<string, number> };

  constructor(
    private readonly session: AgentSession,
    private readonly rendering: ExtensionRendering,
    /** Whether an extension placed a component for a custom entry type. */
    private readonly entryView: (customType: string) => boolean = () => false,
  ) {}

  private get manager() {
    return this.session.sessionManager;
  }
  /** The model's view of the session, rebuilt only when the session grew. */
  private projection() {
    const leaf = this.manager.getLeafId();
    if (this.cache?.leaf === leaf) return this.cache;
    const projection = this.manager.buildSessionProjection();
    const starts = new Map<string, number>();
    let position = 0;
    for (const entry of projection.entries) {
      starts.set(entry.sourceEntry.id, position);
      position += entry.messages.length;
    }
    return (this.cache = { leaf, projection, starts });
  }
  head(): string | null {
    return this.manager.getLeafId();
  }

  private key(message: object, id?: string, claim?: boolean): string {
    let key = this.keys.get(message);
    if (!key) {
      if (claim && (message as Raw).role === "assistant" && this.streamKey) {
        key = this.streamKey;
        this.streamKey = undefined;
      } else key = id ?? `t${++this.counter}`;
      this.keys.set(message, key);
    }
    return key;
  }

  /** One Pi message as an item; `undefined` for messages the chat does not show. */
  private message(message: Raw, id: string | undefined, pos: number | undefined, claim = false): Item | undefined {
    const role = message.role;
    const base = { ...(id ? { id } : {}), key: this.key(message, id, claim), ...(pos === undefined ? {} : { pos }) };
    const rendered = role === "toolResult" || role === "custom" ? this.rendering.message(message) : undefined;
    const extra = rendered ? { rendered } : {};
    if (role === "user") return { ...base, role, parts: parts(message.content) };
    if (role === "assistant")
      return fit({ ...base, role, parts: parts(message.content), ...(message.stopReason ? { stopReason: label(message.stopReason) } : {}) });
    if (role === "toolResult")
      return fit({
        ...base,
        role,
        parts: parts(message.content),
        toolName: label(message.toolName),
        ...(opaque(message.toolCallId) ? { callId: opaque(message.toolCallId)! } : {}),
        isError: message.isError === true,
        ...(typeof message.durationMs === "number" ? { durationMs: message.durationMs } : {}),
        ...details(message.details),
        ...extra,
      });
    if (role === "custom") {
      if (message.display === false) return undefined;
      return fit({ ...base, role, parts: parts(message.content), customType: label(message.customType), ...details(message.details), ...extra });
    }
    if (role === "compactionSummary" || role === "branchSummary")
      return { ...base, role: "summary", parts: parts(String(message.summary ?? "")) };
    return undefined;
  }

  /** Whether an entry produces an item, without building it. */
  private shown(entry: SessionEntry): boolean {
    switch (entry.type) {
      case "message":
        return entry.message.role !== "system" && ["user", "assistant", "toolResult", "custom"].includes(entry.message.role);
      case "custom_message":
        return entry.display !== false;
      case "compaction":
      case "branch_summary":
        return true;
      case "custom":
        return (
          entry.customType === NOTICE_ENTRY ||
          !!this.session.extensionRunner.getEntryRenderer(entry.customType) ||
          this.entryView(entry.customType)
        );
      default:
        return false;
    }
  }
  private entry(entry: SessionEntry, starts: Map<string, number>, claim = false): Item | undefined {
    const pos = starts.get(entry.id);
    switch (entry.type) {
      case "message":
        return this.message(entry.message as unknown as Raw, entry.id, pos, claim);
      case "custom_message": {
        const [message] = sessionEntryToContextMessages(entry);
        return message && this.message(message as unknown as Raw, entry.id, pos);
      }
      case "compaction":
      case "branch_summary":
        return { id: entry.id, key: entry.id, role: "summary", parts: parts(entry.summary) };
      case "custom": {
        if (entry.customType === NOTICE_ENTRY)
          return { id: entry.id, key: entry.id, role: "entry", customType: NOTICE_ENTRY, parts: [], ...details(entry.data) };
        const body = this.rendering.entry(entry);
        const view = this.entryView(entry.customType);
        if (!body && !view) return undefined;
        return {
          id: entry.id,
          key: entry.id,
          role: "entry",
          customType: label(entry.customType),
          parts: [],
          // A web view draws the entry's own data; the terminal rendering is its fallback.
          ...(view ? details(entry.data) : {}),
          ...(body ? { rendered: { body } } : {}),
        };
      }
      default:
        return undefined;
    }
  }

  /**
   * Finalized items on the active branch, oldest first: the `limit` before an entry (the newest
   * when none is given), or everything after one. Bounded by count and bytes.
   */
  page(options: { before?: string; after?: string; limit?: number }): ItemsPage {
    const branch = this.manager.getBranch();
    const { starts } = this.projection();
    const limit = Math.min(Math.max(options.limit ?? 40, 1), PAGE_ITEMS);
    const locate = (id: string) => {
      const index = branch.findIndex((entry) => entry.id === id);
      if (index < 0) throw new RuntimeError("not-found");
      return index;
    };
    const items: Item[] = [];
    let bytes = 0;
    const take = (entry: SessionEntry) => {
      const item = this.entry(entry, starts);
      if (!item) return true;
      const size = JSON.stringify(item).length;
      if (items.length && (items.length >= limit || bytes + size > PAGE_BYTES)) return false;
      items.push(item);
      bytes += size;
      return true;
    };
    let more = false;
    if (options.after !== undefined) {
      for (let index = locate(options.after) + 1; index < branch.length; index++)
        if (this.shown(branch[index]!) && !take(branch[index]!)) {
          more = true;
          break;
        }
      return { items, head: this.head(), more };
    }
    const end = options.before === undefined ? branch.length : locate(options.before);
    for (let index = end - 1; index >= 0; index--) {
      const entry = branch[index]!;
      if (!this.shown(entry)) continue;
      if (!take(entry)) {
        more = true;
        break;
      }
    }
    items.reverse();
    return { items, head: this.head(), more };
  }

  /** Items after an entry, for a commit: everything the session gained since the client's head. */
  since(after: string | null): Item[] | undefined {
    const branch = this.manager.getBranch();
    const from = after === null ? 0 : branch.findIndex((entry) => entry.id === after) + 1;
    if (after !== null && from === 0) return undefined;
    const { starts } = this.projection();
    const entries = branch.slice(from).filter((entry) => this.shown(entry));
    // Of the assistant messages that arrived together, the last is the one that was streaming.
    const last = entries.findLastIndex((entry) => entry.type === "message" && entry.message.role === "assistant");
    return entries.map((entry, index) => this.entry(entry, starts, index === last)).filter((item): item is Item => !!item);
  }

  /** What is not yet in Pi's session: unpersisted messages and the one being written. */
  tail(): Item[] {
    const { projection } = this.projection();
    const committed = projection.messages.length;
    const messages = this.session.messages.slice(committed) as unknown as Raw[];
    const items: Item[] = [];
    const last = messages.findLastIndex((message) => message.role === "assistant");
    messages.forEach((message, index) => {
      const item = this.message(message, undefined, committed + index, index === last);
      if (item) items.push(item);
    });
    const streaming = this.session.state.streamingMessage as unknown as Raw | undefined;
    if (streaming && !messages.includes(streaming)) {
      const item = this.message(streaming, undefined, committed + messages.length);
      if (item) {
        this.streamKey = item.key;
        items.push(item);
      }
    } else this.streamKey = undefined;
    return boundTail(items);
  }

  private raw(id: string): Raw | undefined {
    const entry = this.manager.getEntry(id);
    if (entry?.type === "message") return entry.message as unknown as Raw;
    if (entry?.type === "custom_message") return { content: entry.content };
    return undefined;
  }
  /** Bytes of an image part. */
  image(id: string, index: number): { mimeType: string; data: Buffer } {
    const part = visible(this.raw(id)?.content)[index];
    if (part?.type !== "image" || typeof part.data !== "string" || typeof part.mimeType !== "string" || !IMAGE_TYPES.has(part.mimeType))
      throw new RuntimeError("not-found");
    return { mimeType: part.mimeType, data: Buffer.from(part.data, "base64") };
  }
  /** One chunk of a text part, for text that was clipped. */
  text(id: string, index: number, offset: number): PartPage {
    const part = visible(this.raw(id)?.content)[index];
    if (!part || (part.type !== "text" && part.type !== "thinking")) throw new RuntimeError("not-found");
    const text = String((part.type === "thinking" ? part.thinking : part.text) ?? "");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new RuntimeError("invalid-input");
    let end = Math.min(text.length, offset + TEXT_PAGE);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
    return { text: text.slice(offset, end), ...(end < text.length ? { next: end } : {}) };
  }
}
