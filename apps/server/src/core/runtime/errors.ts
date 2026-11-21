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
