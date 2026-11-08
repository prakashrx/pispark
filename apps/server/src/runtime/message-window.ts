import { createHash } from "node:crypto";
import type { MessagePage, MessageRef, NativeMessage } from "../protocol.js";
import { RuntimeError } from "./errors.js";

type Part = {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  name?: unknown;
  id?: unknown;
};

function partsOf(content: unknown): Part[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function partText(part: Part): string {
  if (typeof part.text === "string") return part.text;
  if (typeof part.thinking === "string") return part.thinking;
  if (part.type === "toolCall") return "Tool requested";
  if (part.type === "image") return "[Image omitted]";
  return "";
}

function redact(text: string, secret?: string): string {
  return secret ? text.replaceAll(secret, "[redacted]") : text;
}

function label(value: unknown, secret?: string): string {
  if (typeof value !== "string") return "";
  return redact(value.slice(0, 32 + (secret?.length ?? 0)), secret)
    .slice(0, 32)
    .replace(/[\p{Cs}\p{Cc}]/gu, " ");
}

// An opaque fixed-size identifier keeps tool pairing independent of provider ID length.
function callId(value: unknown): string | undefined {
  if (typeof value === "string" && value)
    return createHash("sha256").update(value).digest("base64url");
}

export function messageWindow(
  value: unknown,
  secret: string | undefined,
  budget: { remaining: number; truncated: boolean },
  reference?: () => MessageRef,
): NativeMessage {
  const item = (value ?? {}) as Record<string, unknown>;
  const content = partsOf(item.content);
  let clipped = content.length > 16;
  const parts = content.slice(0, 16).map((part) => {
    const raw = partText(part);
    const limit = Math.min(4096, budget.remaining);
    const safe = redact(raw.slice(0, limit + (secret?.length ?? 0)), secret);
    const text = safe.slice(0, limit);
    clipped ||= raw.length > limit || safe.length > limit;
    budget.remaining -= text.length;
    return {
      type: label(part.type, secret),
      name: label(part.name, secret) || undefined,
      callId: part.type === "toolCall" ? callId(part.id) : undefined,
      text,
    };
  });
  budget.truncated ||= clipped;
  return {
    role: label(item.role, secret),
    toolName: label(item.toolName, secret) || undefined,
    callId: callId(item.toolCallId),
    isError: item.isError === true,
    stopReason: label(item.stopReason, secret) || undefined,
    detail: clipped ? reference?.() : undefined,
    parts,
  };
}

/** Only the same public text as the preview, including redaction before pagination. */
export function messagePage(
  value: object,
  secret: string | undefined,
  part: number,
  offset: number,
): MessagePage {
  const content = partsOf("content" in value ? value.content : undefined);
  const current = content[part];
  if (!current || !Number.isSafeInteger(offset) || offset < 0)
    throw new RuntimeError("invalid-input");
  const text = partText(current);
  if (offset > text.length) throw new RuntimeError("invalid-input");
  let end = Math.min(text.length, offset + 8192);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
  let cursor = offset;
  let safe = "";
  if (secret) {
    // Inspect only this page plus the overlap needed to mask a secret at either edge.
    // Callers may supply an offset inside a secret instead of using our next cursor.
    const start = Math.max(0, offset - secret.length + 1);
    const scan = text.slice(start, end + secret.length - 1);
    for (
      let match = scan.indexOf(secret);
      match >= 0 && start + match < end;
      match = scan.indexOf(secret, match + secret.length)
    ) {
      const position = start + match;
      safe += text.slice(cursor, position) + "[redacted]";
      cursor = position + secret.length;
    }
  }
  safe += text.slice(cursor, end);
  const nextOffset = Math.max(cursor, end);
  const next =
    nextOffset < text.length
      ? { part, offset: nextOffset }
      : part + 1 < content.length
        ? { part: part + 1, offset: 0 }
        : undefined;
  return { text: safe, next };
}
