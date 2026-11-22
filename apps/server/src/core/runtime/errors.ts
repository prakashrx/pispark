import { isContextOverflow, isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ReplyFailure } from "../../contract/protocol.js";
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

/** Normalize only provider responses that explicitly identify an exhausted usage allowance. */
export function providerUsageLimited(provider: unknown, message: unknown): boolean {
  if (typeof message !== "string" || (provider !== "openai" && provider !== "openai-codex")) return false;
  return /\b(subscription_sharing_usage_limit_exceeded|subscription_sharing_workplace_individual_usage_limit_exceeded|usage_limit_reached|insufficient_quota)\b/i.test(message)
    || /^(?:Codex error: )?The usage limit has been reached\b/i.test(message)
    || /\bThe ChatGPT user has reached their Subscription Sharing usage limit\b/i.test(message);
}

/** A failed reply as Pi recorded it, classified with Pi's own rules where it has them. */
export function replyFailure(message: AssistantMessage, contextWindow?: number): ReplyFailure {
  const text = message.errorMessage ?? "";
  if (providerUsageLimited(message.provider, text) || /usage.?limit|quota|out of budget|billing|credit balance/i.test(text)) return "usage-limit";
  if (isContextOverflow(message, contextWindow)) return "context-full";
  if (isRetryableAssistantError(message)) return "unavailable";
  if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid.{0,12}(api.?key|token|credential)|authenticat|not signed in|sign in again|expired.{0,12}token|token.{0,12}(expired|revoked)/i.test(text)) return "signed-out";
  return "failed";
}

/**
 * The provider's own words for a failure, for the person to read: one paragraph, bounded, with
 * anything that looks like a key, a token or a file path taken out.
 */
export function providerMessage(text: string | undefined): string | undefined {
  const cleaned = (text ?? "")
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, "$1 [hidden]")
    .replace(/\b(sk|pk|rk|key|tok|ghp|gho|xox[abp])[-_][\w-]{8,}/gi, "[hidden]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[hidden]")
    .replace(/\b[A-Za-z]:\\[^\s"'<>|;,)]+/g, "[path]")
    .replace(/(^|[\s("'=])\/(?:home|Users|root|tmp|var|etc|opt|usr|mnt|srv)\/[^\s"'<>;,)]+/g, "$1[path]")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > 400 ? `${cleaned.slice(0, 399)}…` : cleaned;
}

/** Public errors never include provider exceptions, credentials or filesystem paths. */
export class RuntimeError extends Error {
  constructor(readonly code: RuntimeErrorCode) {
    super(`Session runtime: ${code}`);
    this.name = "RuntimeError";
  }
}

export function runtimeError(
  error: unknown,
  fallback: RuntimeErrorCode,
): RuntimeError {
  return error instanceof RuntimeError ? error : new RuntimeError(fallback);
}

export function unsupported(): never {
  throw new RuntimeError("unsupported");
}

export async function deadline<T>(
  operation: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RuntimeError("timeout")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
