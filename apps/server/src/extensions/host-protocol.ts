import type { EventBus } from "@earendil-works/pi-coding-agent";

export const HOST_REQUEST = "pispark:host/request";
export const TITLE_TOOL = "pispark_set_title";
export type HostReply =
  | { ok: true }
  | {
      ok: false;
      error: "unavailable" | "invalid-input" | "storage" | "aborted";
    };
export interface TitleRequest {
  operation: "chat.set_title";
  title: string;
  signal: AbortSignal;
  settle: (reply: HostReply) => void;
}

/** One in-process capability, not a serialized or arbitrary-method RPC interface. */
export function requestTitle(
  bus: EventBus,
  title: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (reply: HostReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (reply.ok) resolve();
      else reject(new Error(`PiSpark title update: ${reply.error}`));
    };
    const abort = () => {
      controller.abort();
      finish({ ok: false, error: "aborted" });
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      finish({ ok: false, error: "unavailable" });
    }, 5_000);
    try {
      bus.emit(HOST_REQUEST, {
        operation: "chat.set_title",
        title,
        signal: controller.signal,
        settle: finish,
      } satisfies TitleRequest);
    } catch {
      finish({ ok: false, error: "unavailable" });
    }
  });
}

/** Capture the ownership closure before loading any native extension factory. */
export function bindHost(
  bus: EventBus,
  setTitle: (title: string, signal: AbortSignal) => void,
): () => void {
  let closed = false;
  const pending = new Set<(reply: HostReply) => void>();
  const unsubscribe = bus.on(HOST_REQUEST, (data) => {
    if (!data || typeof data !== "object") return;
    const request = data as Partial<TitleRequest>;
    if (typeof request.settle !== "function") return;
    const settle = (reply: HostReply) => {
      pending.delete(settle);
      try {
        request.settle!(reply);
      } catch {
        /* Never leak callback failures to the native bus logger. */
      }
    };
    pending.add(settle);
    if (
      request.operation !== "chat.set_title" ||
      typeof request.title !== "string" ||
      !(request.signal instanceof AbortSignal) ||
      Object.keys(data).some(
        (key) => !["operation", "title", "signal", "settle"].includes(key),
      )
    )
      return settle({ ok: false, error: "invalid-input" });
    if (closed) return settle({ ok: false, error: "unavailable" });
    if (request.signal.aborted) return settle({ ok: false, error: "aborted" });
    try {
      setTitle(request.title, request.signal);
      settle({ ok: true });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      settle({
        ok: false,
        error:
          code === "storage"
            ? "storage"
            : code === "invalid-input"
              ? "invalid-input"
              : "unavailable",
      });
    }
  });
  return () => {
    closed = true;
    unsubscribe();
    for (const settle of pending) settle({ ok: false, error: "unavailable" });
    pending.clear();
  };
}
