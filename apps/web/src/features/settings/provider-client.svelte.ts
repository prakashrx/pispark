import type {
  ProviderCatalog,
  ModelChoice,
  AuthView,
} from "../../../../server/src/contract/provider-protocol";
import { providerErrorMessages } from "../../../../server/src/contract/provider-protocol";
export async function providerRequest<T>(
  path: string,
  value?: unknown,
  token?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/providers${path}`, {
    method: value === undefined ? "GET" : "POST",
    headers: {
      ...(value === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error(
      "Provider settings unavailable. No successful change is confirmed.",
    );
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024)
        throw new Error("Provider catalog exceeds the display limit.");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  const data = JSON.parse(text + decoder.decode());
  if (!response.ok)
    throw new Error(
      providerErrorMessages[data.error] ??
        "Provider settings request failed. Reload status before trying again; no successful change is confirmed.",
    );
  return data as T;
}
export class ProviderClient {
  catalog = $state<ProviderCatalog>({
    providers: [],
    defaultModel: null,
    networkBlocked: false,
  });
  loading = $state(false);
  error = $state("");
  busy = $state(false);
  private generation = 0;
  private controller = new AbortController();
  async refresh() {
    const generation = ++this.generation;
    this.loading = true;
    try {
      const data = await providerRequest<ProviderCatalog>(
        "",
        undefined,
        undefined,
        this.controller.signal,
      );
      if (generation === this.generation) {
        this.catalog = data;
        this.error = "";
      }
    } catch {
      if (!this.controller.signal.aborted && generation === this.generation)
        this.error =
          "Provider settings unavailable. Retry loading; existing sessions and drafts are unchanged.";
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }
  async change(
    path: "/default" | "/logout" | "/refresh",
    value: { model: ModelChoice | null } | { provider: string },
  ) {
    if (this.busy) return false;
    this.busy = true;
    this.error = "";
    try {
      await providerRequest(path, value, undefined, this.controller.signal);
      await this.refresh();
      return true;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Provider operation failed.";
      return false;
    } finally {
      this.busy = false;
    }
  }
  dispose() {
    this.generation++;
    this.controller.abort();
  }
}
/** One mounted dialog owns its capability. Never browser storage, global catalog or session broadcasts. */
export class AuthClient {
  view = $state<AuthView>();
  busy = $state(false);
  error = $state("");
  private capability?: { id: string; token: string };
  private disposed = false;
  private expires = 0;
  private lastObserved = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly changed: () => void) {}
  async start(provider: string, method: "api_key" | "oauth") {
    if (this.busy || this.capability) return;
    this.busy = true;
    this.error = "";
    try {
      const capability = await providerRequest<{ id: string; token: string }>(
        "/auth/start",
        { provider, method },
      );
      this.capability = capability;
      this.expires = Date.now() + 600_000;
      this.lastObserved = Date.now();
      if (this.disposed) {
        this.cancel();
        return;
      }
      await this.poll();
    } catch (error) {
      if (!this.disposed)
        this.error =
          error instanceof Error ? error.message : "Sign-in could not start.";
    } finally {
      this.busy = false;
    }
  }
  private async poll() {
    const c = this.capability;
    if (!c || this.disposed) return;
    if (Date.now() >= this.expires || Date.now() - this.lastObserved > 30_000) {
      this.cancel();
      this.view = undefined;
      this.error =
        "Sign-in expired or disconnected. Reload provider status before starting again; no successful save is confirmed.";
      return;
    }
    try {
      const view = await providerRequest<AuthView>(
        "/auth/observe",
        { id: c.id },
        c.token,
      );
      if (this.disposed) return;
      this.view = view;
      this.error = "";
      this.lastObserved = Date.now();
      if (view.state !== "pending") {
        this.capability = undefined;
        this.changed();
        return;
      }
    } catch {
      if (!this.disposed)
        this.error =
          "Sign-in connection interrupted. Reconnecting for up to30 seconds; the host cancels abandoned sign-in. No successful save is confirmed.";
    }
    if (!this.disposed) this.timer = setTimeout(() => void this.poll(), 1000);
  }
  async respond(prompt: string, value: string) {
    const c = this.capability;
    if (!c || this.busy) return;
    this.busy = true;
    try {
      await providerRequest(
        "/auth/respond",
        { id: c.id, prompt, value },
        c.token,
      );
      if (this.view?.prompt?.id === prompt) this.view.prompt = undefined;
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : "Prompt response was not accepted.";
    } finally {
      this.busy = false;
    }
  }
  private cancel() {
    const c = this.capability;
    this.capability = undefined;
    if (c)
      void providerRequest("/auth/cancel", { id: c.id }, c.token).catch(
        () => {},
      );
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.cancel();
    this.view = undefined;
  }
}
