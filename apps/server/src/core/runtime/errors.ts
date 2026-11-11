export type RuntimeErrorCode =
  | "invalid-input"
  | "not-found"
  | "busy"
  | "limit"
  | "configuration"
  | "credentials"
  | "resources"
  | "folder"
  | "persona"
  | "storage"
  | "owned"
  | "sdk-version"
  | "unsupported"
  | "extension"
  | "execution"
  | "timeout"
  | "closed";

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
