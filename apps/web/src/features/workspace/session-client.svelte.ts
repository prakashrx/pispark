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
import type { CommandUncertaintyKind } from "./chat-presentation";
class CommandUncertainty extends Error {
  constructor(
    readonly kind: CommandUncertaintyKind,
    detail: string,
  ) {
    super(detail);
  }
}
import { ProviderClient } from "../settings/provider-client.svelte";
import type { ModelChoice } from "../../../../server/src/provider-protocol";
import type { PersonaSelection } from "../../../../server/src/persona-protocol";
import { PersonaClient } from "../persona/persona-client.svelte";
const context = Symbol("session-client");
type InputCommand = Command extends infer C
  ? C extends Command
    ? Omit<C, "commandId">
    : never
  : never;

/** Transport is confined here; components consume state/actions and never persist canonical messages. */
export class SessionClient {
  readonly providers = new ProviderClient();
  readonly personas = new PersonaClient();
  catalog = $state<Catalog>({ workspaces: [], configurations: [] });
  catalogLoading = $state(true);
  catalogError = $state(false);
  sessions = $state<SessionInfo[]>([]);
  selected = $state("");
  snapshot = $state<SessionWindow>();
  older = $state<SessionWindow>();
  drafts = $state<Record<string, string>>({});
  connection = $state("Loading");
  error = $state("");
  errorKind = $state<CommandUncertaintyKind>();
  listNotice = $state("");
  sessionErrors = $state<Record<string, string>>({});
  sessionErrorKinds = $state<
    Record<string, CommandUncertaintyKind | undefined>
  >({});
  private recordError(error: unknown, id?: string) {
    const detail = (error as Error).message;
    const kind = error instanceof CommandUncertainty ? error.kind : undefined;
    if (id) {
      this.sessionErrors[id] = detail;
      this.sessionErrorKinds[id] = kind;
    } else {
      this.error = detail;
      this.errorKind = kind;
    }
  }
  private draftRevisions = new Map<string, number>();
  private nextDraftRevision = 0;
  busy = $state(false);
  private source?: AbortController;
  private controller = new AbortController();
  private selection = 0;
  private disposed = false;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private mounting = false;
  private offline = () => {
    this.source?.abort();
    this.connection = "Reconnecting";
  };
  private online = () => this.reconnect();
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.personas.dirty || this.personas.hasUnsavedFiles) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
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
    if (this.mounting || this.disposed) return;
    this.mounting = true;
    this.connection = "Loading";
    this.error = "";
    this.errorKind = undefined;
    void this.providers.refresh();
    void this.personas.refresh();
    window.addEventListener("beforeunload", this.beforeUnload);
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    this.catalogLoading = true;
    this.catalogError = false;
    try {
      this.catalog = await this.json<Catalog>("/api/catalog");
      this.catalogLoading = false;
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
        this.errorKind = undefined;
        this.catalogError = this.catalogLoading;
      }
    } finally {
      this.catalogLoading = false;
      this.mounting = false;
    }
  }
  async refresh() {
    const result = await this.json<{
      sessions: SessionInfo[];
      truncated: boolean;
    }>("/api/sessions");
    this.sessions = result.sessions;
    this.listNotice = result.truncated
      ? "Showing your latest 256 chats. Older chats are still saved."
      : "";
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
      throw new CommandUncertainty(
        "acceptance-unknown",
        `Command ${commandId}: ${(error as Error).message}. Acceptance unknown; inspect session before sending again.`,
      );
    }
  }
  private async settled(receipt: Receipt): Promise<Receipt> {
    const until = Date.now() + 310_000;
    while (receipt.state === "accepted") {
      try {
        if (this.disposed) throw new Error("Client closed");
        if (Date.now() > until)
          throw new Error(
            `Settlement unknown for ${receipt.commandId}; do not automatically retry.`,
          );
        await new Promise((resolve) => setTimeout(resolve, 250));
        receipt = await this.json<Receipt>(
          `/api/receipts/${receipt.commandId}`,
        );
      } catch (error) {
        throw new CommandUncertainty(
          "settlement-unknown",
          `${(error as Error).message}${receipt.sessionId ? ` (chat ${receipt.sessionId})` : ""}`,
        );
      }
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
      this.recordError(error, id);
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
                    title: value.snapshot.title,
                    hasHistory: value.snapshot.hasHistory,
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
      this.errorKind = undefined;
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
    delete this.sessionErrorKinds[id];
    try {
      await this.settled(await this.submit({ type: "stop", sessionId: id }));
      if (this.selected === id) {
        this.source?.abort();
        this.snapshot = undefined;
        this.connection = "Unloaded";
      }
      await this.refresh();
    } catch (error) {
      this.recordError(error, id);
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
        this.errorKind = undefined;
      });
  }
  async ask(
    text: string,
    workspace: string,
    configuration: string,
    model?: ModelChoice,
    persona?: PersonaSelection,
  ): Promise<boolean> {
    if (this.busy || !text.trim() || !workspace || !configuration) return false;
    this.busy = true;
    this.error = "";
    this.errorKind = undefined;
    let id: string | undefined;
    try {
      const created = await this.settled(
        await this.submit({
          type: "create",
          workspace,
          configuration,
          ...(model ? { model } : {}),
          ...(persona ? { persona } : {}),
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
      this.recordError(error, id);
      if (!id) this.error = `New session: ${this.error}`;
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
    delete this.sessionErrorKinds[id];
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
      this.recordError(error, id);
    } finally {
      this.busy = false;
    }
  }
  private watch(receipt: Receipt) {
    void this.settled(receipt).catch((error) => {
      if (!this.disposed) {
        this.recordError(error, receipt.sessionId);
      }
    });
  }
  async cancel() {
    const id = this.selected;
    if (!id) return;
    delete this.sessionErrors[id];
    delete this.sessionErrorKinds[id];
    try {
      await this.settled(await this.submit({ type: "cancel", sessionId: id }));
    } catch (error) {
      this.recordError(error, id);
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
      this.recordError(error, id);
    }
  }
  dispose() {
    this.providers.dispose();
    this.disposed = true;
    this.selection++;
    this.source?.abort();
    this.controller.abort();
    clearInterval(this.refreshTimer);
    window.removeEventListener("beforeunload", this.beforeUnload);
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
