import { getContext, setContext } from "svelte";
import type { Catalog, HostSettings, SessionDoc, SessionInfo } from "../../../../server/src/contract/protocol";
import type { ModelChoice } from "../../../../server/src/contract/provider-protocol";
import type { CommandUncertaintyKind } from "./chat-presentation";
import { ChatSession } from "./chat-session.svelte";
import { CommandUncertainty, Transport } from "./transport";
import { ProviderClient } from "../settings/provider-client.svelte";
import { PersonaClient } from "../persona/persona-client.svelte";
const context = Symbol("session-client");

/** How many chats stay in memory as they were last shown, so opening one again shows it at once. */
const KEPT = 8;

/**
 * The app around the chats: the chat list, which chat is open, starting a new one, and PiSpark's
 * settings. Each chat that has been opened is a `ChatSession`, which owns everything about it.
 */
export class SessionClient {
  readonly providers = new ProviderClient();
  readonly personas = new PersonaClient();
  catalog = $state<Catalog>({ home: "", recentFolders: [] });
  /** PiSpark's own settings; undefined until loaded. */
  settings = $state<HostSettings>();
  catalogLoading = $state(true);
  catalogError = $state(false);
  sessions = $state<SessionInfo[]>([]);
  /** The open chat. */
  current = $state<ChatSession>();
  get selected(): string {
    return this.current?.id ?? "";
  }
  /** The server as a whole: "Loading", "Connected" or "Disconnected". */
  private backend = $state("Loading");
  /** What the shell shows: the open chat's connection once the server is reached. */
  get connection(): string {
    return this.backend === "Connected" && this.current ? this.current.connection : this.backend;
  }
  error = $state("");
  errorKind = $state<CommandUncertaintyKind>();
  listNotice = $state("");
  /** A new chat is being created. */
  private asking = $state(false);
  /** Something is being sent; the composers wait. */
  get busy(): boolean {
    return this.asking || !!this.current?.sending;
  }
  private readonly transport = new Transport();
  /** Chats that have been opened, least recently shown first. */
  private readonly opened = new Map<string, ChatSession>();
  private disposed = false;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private mounting = false;
  private offline = () => this.current?.offline();
  private online = () => this.reconnect();
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.personas.unsaved) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  private fail(error: unknown) {
    this.error = (error as Error).message;
    this.errorKind = error instanceof CommandUncertainty ? error.kind : undefined;
  }

  async mount() {
    if (this.mounting || this.disposed) return;
    this.mounting = true;
    this.backend = "Loading";
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
      this.catalog = await this.transport.json<Catalog>("/api/catalog");
      void this.transport
        .json<HostSettings>("/api/settings")
        .then((settings) => (this.settings = settings))
        .catch(() => {});
      this.catalogLoading = false;
      await this.refresh();
      this.backend = "Connected";
      this.refreshTimer ??= setInterval(() => {
        if (this.refreshing || this.disposed) return;
        this.refreshing = true;
        void this.refresh()
          .catch(() => {})
          .finally(() => {
            this.refreshing = false;
          });
      }, 5000);
      let stored: string | null = null;
      try {
        stored = localStorage.getItem("pispark-session");
      } catch { /* Selection is optional when browser storage is unavailable. */ }
      const session = this.sessions.find((s) => s.id === stored) ?? this.sessions.at(-1);
      if (session) await this.select(session.id);
    } catch {
      if (!this.disposed) {
        this.backend = "Disconnected";
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
    const result = await this.transport.json<{
      sessions: SessionInfo[];
      truncated: boolean;
      unreadable?: number;
    }>("/api/sessions");
    this.sessions = result.sessions;
    for (const row of result.sessions) {
      const chat = this.opened.get(row.id);
      if (chat) chat.row = row;
    }
    this.listNotice = result.truncated
      ? "Showing your latest 256 chats. Older chats are still saved."
      : "";
    if (result.unreadable) {
      this.listNotice = [this.listNotice, `${result.unreadable} chat records could not be read.`].filter(Boolean).join(" ");
    }
  }

  /** The chat's session object, kept from when it was last open or made now. */
  session(id: string): ChatSession {
    let chat = this.opened.get(id);
    if (!chat) {
      chat = new ChatSession(id, this.transport, {
        changed: (session) => this.track(id, session),
        refresh: () => this.refresh(),
        roomForDraft: () => [...this.opened.values()].filter((other) => other.draft).length < 32,
        notice: (message) => {
          this.error = message;
          this.errorKind = undefined;
        },
      });
    }
    // Most recently used last. A chat with an unsent draft is never dropped.
    this.opened.delete(id);
    this.opened.set(id, chat);
    for (const [other, kept] of this.opened) {
      if (this.opened.size <= KEPT) break;
      if (kept !== this.current && kept !== chat && !kept.draft) this.opened.delete(other);
    }
    chat.row = this.sessions.find((s) => s.id === id) ?? chat.row;
    return chat;
  }
  /** Opens a chat: it shows at once as it was last seen, and the live stream brings it up to date. */
  async select(id: string) {
    const chat = this.session(id);
    if (this.current !== chat) this.current?.hide();
    this.current = chat;
    try {
      localStorage.setItem("pispark-session", id);
    } catch { /* In-memory selection still works. */ }
    await chat.show();
  }
  /** Keep the chat list's row in step with what the open chat reports. */
  private track(id: string, session: SessionDoc) {
    const row = this.sessions.find((s) => s.id === id);
    const next = {
      title: session.title,
      hasHistory: session.hasHistory,
      status: session.status,
      interrupted: session.interrupted,
      persona: session.persona,
      personaChanged: session.personaChanged,
      waiting: session.waiting,
      queued: session.queued,
    };
    if (row && JSON.stringify(next) !== JSON.stringify({ title: row.title, hasHistory: row.hasHistory, status: row.status, interrupted: row.interrupted, persona: row.persona, personaChanged: row.personaChanged, waiting: row.waiting, queued: row.queued }))
      this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, ...next } : s));
  }
  /** Saves a settings change; rejects when the server refused it. */
  async saveSettings(settings: HostSettings): Promise<void> {
    this.settings = await this.transport.json<HostSettings>("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  }
  reconnect() {
    if (this.current) void this.current.reconnect();
    else void this.mount();
  }
  /** Starts a new chat with a first message, in `folder` or, without one, in its project persona's. */
  async ask(
    text: string,
    folder: string | undefined,
    model?: ModelChoice,
    persona?: string,
  ): Promise<boolean> {
    if (this.busy || !text.trim()) return false;
    this.asking = true;
    this.error = "";
    this.errorKind = undefined;
    let id: string | undefined;
    try {
      const created = await this.transport.run({
        type: "create",
        ...(folder?.trim() ? { folder: folder.trim() } : {}),
        ...(model ? { model } : {}),
        ...(persona ? { persona } : {}),
      });
      id = created.sessionId!;
      await this.refresh();
      // New recent folders for the picker.
      void this.transport
        .json<Catalog>("/api/catalog")
        .then((catalog) => (this.catalog = catalog))
        .catch(() => {});
      await this.select(id);
      const receipt = await this.transport.submit({ type: "start", sessionId: id, text });
      if (receipt.error) throw new Error(`${receipt.error} (${receipt.commandId})`);
      const chat = this.session(id);
      void this.transport.settled(receipt).catch((error) => {
        if (!this.disposed) chat.fail(error);
      });
      window.location.hash = "/workspace";
      return true;
    } catch (error) {
      if (id) this.session(id).fail(error);
      else {
        this.fail(error);
        // The server's code for a working folder that is not there, in words.
        this.error = `New session: ${this.error.startsWith("folder (") ? "that working folder doesn’t exist on the server." : this.error}`;
      }
      return false;
    } finally {
      this.asking = false;
    }
  }
  dispose() {
    this.providers.dispose();
    this.disposed = true;
    for (const chat of this.opened.values()) chat.hide();
    this.transport.close();
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

const chatContext = Symbol("chat-session");
/** Gives one chat to everything that draws it. */
export function provideChat(chat: ChatSession) {
  setContext(chatContext, chat);
  return chat;
}
/** The chat this component is drawing. */
export function useChat(): ChatSession {
  return getContext(chatContext);
}
