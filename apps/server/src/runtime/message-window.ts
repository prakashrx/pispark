import type { NativeMessage } from "../protocol.js";

/** Bounded projection of native text/tool content. Never stringify arbitrary tool arguments or image data. */
export function messageWindow(
  value: unknown,
  secret: string | undefined,
  budget: { remaining: number; truncated: boolean },
): NativeMessage {
  const text = (value: unknown): string => {
    if (typeof value !== "string") return "";
    // Redact before clipping: do not expose a prefix of a secret crossing the boundary.
    const limit = Math.min(4096, budget.remaining);
    let result = value.slice(0, limit + (secret?.length ?? 0));
    if (secret) result = result.split(secret).join("[redacted]");
    if (value.length > limit) budget.truncated = true;
    result = result.slice(0, limit);
    budget.remaining -= result.length;
    return result;
  };
  const item = (value ?? {}) as Record<string, unknown>;
  const content =
    typeof item.content === "string"
      ? [{ type: "text", text: item.content }]
      : Array.isArray(item.content)
        ? item.content
        : [];
  if (content.length > 16) budget.truncated = true;
  return {
    role: text(item.role),
    toolName: text(item.toolName) || undefined,
    isError: item.isError === true,
    stopReason: text(item.stopReason) || undefined,
    parts: content.slice(0, 16).map((part: Record<string, unknown>) => ({
      type: text(part.type),
      name: text(part.name) || undefined,
      text:
        text(part.text ?? part.thinking) ||
        (part.type === "toolCall"
          ? "Tool requested"
          : part.type === "image"
            ? "[Image omitted]"
            : ""),
    })),
  };
}
