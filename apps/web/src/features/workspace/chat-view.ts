import type { Item, SessionDoc, StyledLine } from "../../../../server/src/protocol";

/** A clipped part of a finalized item, read on demand. */
export interface PartRef {
  id: string;
  part: number;
}
export interface MessagePart {
  callId?: string;
  type: string;
  text: string;
  name?: string;
}
/**
 * What the conversation components draw for one item. This is the existing presentation shape;
 * the live protocol's `Item` is converted here and nowhere else.
 */
export interface NativeMessage {
  /** Position in Pi's context; extension notices are placed by it. */
  index?: number;
  callId?: string;
  detail?: PartRef;
  role: string;
  parts: MessagePart[];
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  rendered?: { call?: StyledLine[]; body?: StyledLine[] };
}
export interface ChatView extends SessionDoc {
  messages: NativeMessage[];
}

export function toMessage(item: Item): NativeMessage {
  const clipped = item.parts.findIndex(
    (part) => (part.type === "text" || part.type === "thinking") && part.size !== undefined,
  );
  return {
    index: item.pos,
    callId: item.callId,
    // Custom entries an extension renders look like its custom messages.
    role: item.role === "entry" ? "custom" : item.role,
    toolName: item.toolName,
    isError: item.isError,
    stopReason: item.stopReason,
    rendered: item.rendered,
    detail: clipped >= 0 && item.id ? { id: item.id, part: clipped } : undefined,
    parts: item.parts.map((part) =>
      part.type === "toolCall"
        ? { type: "toolCall", name: part.name, callId: part.id, text: "Tool requested" }
        : part.type === "image"
          ? { type: "image", text: "[Image omitted]" }
          : { type: part.type, text: part.text },
    ),
  };
}
