import { getContext, setContext } from "svelte";
import type {
  Catalog,
  Command,
  Receipt,
  SessionInfo,
  SessionWindow,
} from "../../../../server/src/protocol";
export type { NativeMessage } from "../../../../server/src/protocol";
import { snapshots } from "./snapshot-stream";
import { ProviderClient } from "../settings/provider-client.svelte";
import type { ModelChoice } from "../../../../server/src/provider-protocol";
const context = Symbol("session-client");
type InputCommand = Command extends infer C
  ? C extends Command
    ? Omit<C, "commandId">
    : never
  : never;

/** Transport is confined here; components consume state/actions and never persist canonical messages. */
export class SessionClient {
  readonly providers = new ProviderClient();
  catalog = $state<Catalog>({ workspaces: [], configurations: [] });
  sessions = $state<SessionInfo[]>([]);
  selected = $state("");
  snapshot = $state<SessionWindow>();
  older = $state<SessionWindow>();
  drafts = $state<Record<string, string>>({});
  connection = $state("Loading");
  error = $state("");
  sessionErrors = $state<Record<string, string>>({});
  private draftRevisions = new Map<string, number>();
  private nextDraftRevision = 0;
  busy = $state(false);
  private source?: AbortController;
  private controller = new AbortController();
  private selection = 0;
  private disposed = false;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private offline = () => {
    this.source?.abort();
    this.connection = "Reconnecting";
  };
  private online = () => this.reconnect();
  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      signal: AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(12_000),
      ]),
    });
    // The host bounds every response. Refuse unexpectedly large payloads before JSON parsing too.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No server response");
    let text = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256 * 1024) throw new Error("Response limit");
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
    const result = JSON.parse(text + decoder.decode());
    if (!response.ok) throw new Error(result.error ?? "Request failed");
    return result as T;
  }
  async mount() {
    void this.providers.refresh();
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    try {
      this.catalog = await this.json<Catalog>("/api/catalog");
      await this.refresh();
      this.connection = "Connected";
      this.refreshTimer ??= setInterval(() => {
        if (this.refreshing || this.disposed) return;
        this.refreshing = true;
        void this.refresh()
          .catch(() => {})
          .finally(() => {
            this.refreshing = false;
          });
      }, 5000);
      const stored = localStorage.getItem("pispark-session");
      const session =
        this.sessions.find((s) => s.id === stored) ?? this.sessions.at(-1);
      if (session) await this.select(session.id);
    } catch {
      if (!this.disposed) {
        this.connection = "Disconnected";
        this.error = "Backend unavailable. Drafts have not been sent.";
      }
    }
  }
  async refresh() {
    const result = await this.json<{
      sessions: SessionInfo[];
      truncated: boolean;
    }>("/api/sessions");
    this.sessions = result.sessions;
    if (result.truncated)
      this.error =
        "Only the latest256 sessions are listed. Older history remains on the host.";
  }
  private async submit(command: InputCommand): Promise<Receipt> {
    const commandId = crypto.randomUUID();
    try {
      return await this.json<Receipt>("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, commandId }),
      });
    } catch (error) {
      throw new Error(
        `Command ${commandId}: ${(error as Error).message}. Acceptance unknown; inspect session before sending again.`,
      );
    }
  }
  private async settled(receipt: Receipt): Promise<Receipt> {
    const until = Date.now() + 310_000;
    while (receipt.state === "accepted") {
      if (this.disposed) throw new Error("Client closed");
      if (Date.now() > until)
        throw new Error(
          `Settlement unknown for ${receipt.commandId}; do not automatically retry.`,
        );
      await new Promise((resolve) => setTimeout(resolve, 250));
      receipt = await this.json<Receipt>(`/api/receipts/${receipt.commandId}`);
    }
    if (receipt.error)
      throw new Error(`${receipt.error} (${receipt.commandId})`);
    return receipt;
  }
  async select(id: string) {
    const generation = ++this.selection;
    this.source?.abort();
    this.snapshot = undefined;
    this.older = undefined;
    this.selected = id;
    this.connection = "Connecting";
    try {
      localStorage.setItem("pispark-session", id);
      if (this.sessions.find((s) => s.id === id)?.status === "unloaded")
        await this.settled(await this.submit({ type: "open", sessionId: id }));
      if (generation !== this.selection || this.disposed) return;
      this.observe(id);
    } catch (error) {
      this.sessionErrors[id] = (error as Error).message;
      if (generation === this.selection) {
        this.connection = "Disconnected";
      }
    }
  }
  private observe(id: string) {
    this.source?.abort();
    const source = new AbortController();
    this.source = source;
    void (async () => {
      while (!source.signal.aborted && !this.disposed) {
        let sequence = -1;
        try {
          const response = await fetch(`/api/sessions/${id}/events`, {
            signal: AbortSignal.any([
              source.signal,
              AbortSignal.timeout(70_000),
            ]),
          });
          for await (const value of snapshots(response)) {
            if (
              source !== this.source ||
              id !== this.selected ||
              source.signal.aborted
            )
              return;
            if (
              value.type !== "snapshot" ||
              value.sessionId !== id ||
              value.snapshot.id !== id ||
              !Number.isSafeInteger(value.sequence) ||
              (sequence === -1 && value.boundary !== "initial")
            )
              throw new Error("Invalid snapshot");
            if (value.sequence <= sequence) continue;
            sequence = value.sequence;
            this.snapshot = value.snapshot;
            this.connection = "Live";
            this.sessions = this.sessions.map((s) =>
              s.id === id
                ? {
                    ...s,
                    status: value.snapshot.status,
                    interrupted: value.snapshot.interrupted,
                  }
                : s,
            );
          }
        } catch {
          /* Lost connection or bounded decoder rejection: reconnect from fresh snapshot, never resend commands. */
        }
        if (source.signal.aborted || this.disposed) return;
        this.connection = "Reconnecting";
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    })();
  }
  setDraft(text: string) {
    if (
      !Object.hasOwn(this.drafts, this.selected) &&
      Object.values(this.drafts).filter(Boolean).length >= 32
    ) {
      this.error =
        "Draft limit: clear an existing draft before starting another.";
      return;
    }
    if (text) {
      this.draftRevisions.set(this.selected, ++this.nextDraftRevision);
      this.drafts[this.selected] = text.slice(0, 65536);
    } else {
      this.draftRevisions.delete(this.selected);
      delete this.drafts[this.selected];
    }
  }
  async stop() {
    const id = this.selected;
    delete this.sessionErrors[id];
    try {
      await this.settled(await this.submit({ type: "stop", sessionId: id }));
      if (this.selected === id) {
        this.source?.abort();
        this.snapshot = undefined;
        this.connection = "Unloaded";
      }
      await this.refresh();
    } catch (error) {
      this.sessionErrors[id] = (error as Error).message;
    }
  }
  reconnect() {
    if (!this.selected) {
      void this.mount();
      return;
    }
    const id = this.selected;
    void this.refresh()
      .then(() => {
        if (!this.disposed && this.selected === id) return this.select(id);
      })
      .catch(() => {
        this.connection = "Disconnected";
        this.error = "Reconnect failed. No prompt was resent.";
      });
  }
  async ask(
    text: string,
    workspace: string,
    configuration: string,
    model?: ModelChoice,
  ): Promise<boolean> {
    if (this.busy || !text.trim() || !workspace || !configuration) return false;
    this.busy = true;
    this.error = "";
    let id: string | undefined;
    try {
      const created = await this.settled(
        await this.submit({
          type: "create",
          workspace,
          configuration,
          ...(model ? { model } : {}),
        }),
      );
      id = created.sessionId!;
      await this.refresh();
      await this.select(id);
      const receipt = await this.submit({
        type: "start",
        sessionId: created.sessionId!,
        text,
      });
      if (receipt.error)
        throw new Error(`${receipt.error} (${receipt.commandId})`);
      this.watch(receipt);
      window.location.hash = "/workspace";
      return true;
    } catch (error) {
      if (id) this.sessionErrors[id] = (error as Error).message;
      else this.error = `New session: ${(error as Error).message}`;
      return false;
    } finally {
      this.busy = false;
    }
  }
  async reply(): Promise<void> {
    const id = this.selected;
    const text = this.drafts[id] ?? "";
    const revision = this.draftRevisions.get(id) ?? 0;
    if (this.busy || !id || !text.trim() || this.snapshot?.status !== "idle")
      return;
    this.busy = true;
    delete this.sessionErrors[id];
    try {
      const receipt = await this.submit({ type: "start", sessionId: id, text });
      if (receipt.error)
        throw new Error(`${receipt.error} (${receipt.commandId})`);
      if ((this.draftRevisions.get(id) ?? 0) === revision) {
        delete this.drafts[id];
        this.draftRevisions.delete(id);
      }
      this.watch(receipt);
    } catch (error) {
      this.sessionErrors[id] = (error as Error).message;
    } finally {
      this.busy = false;
    }
  }
  private watch(receipt: Receipt) {
    void this.settled(receipt).catch((error) => {
      if (!this.disposed) {
        if (receipt.sessionId)
          this.sessionErrors[receipt.sessionId] = (error as Error).message;
        else this.error = (error as Error).message;
      }
    });
  }
  async cancel() {
    const id = this.selected;
    if (!id) return;
    delete this.sessionErrors[id];
    try {
      await this.settled(await this.submit({ type: "cancel", sessionId: id }));
    } catch (error) {
      this.sessionErrors[id] = (error as Error).message;
    }
  }
  async history() {
    const id = this.selected;
    try {
      const before = this.older?.before ?? this.snapshot?.before;
      if (!before) return;
      const value = await this.json<SessionWindow>(
        `/api/sessions/${id}/window?before=${before}`,
      );
      if (id === this.selected) this.older = value;
    } catch (error) {
      this.sessionErrors[id] = (error as Error).message;
    }
  }
  dispose() {
    this.providers.dispose();
    this.disposed = true;
    this.selection++;
    this.source?.abort();
    this.controller.abort();
    clearInterval(this.refreshTimer);
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("online", this.online);
  }
}
export function provideSessions() {
  const client = new SessionClient();
  setContext(context, client);
  return client;
}
export function useSessions(): SessionClient {
  return getContext(context);
}
