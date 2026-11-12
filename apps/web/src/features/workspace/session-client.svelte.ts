import { getContext, setContext } from "svelte";
import type { Catalog, HostSettings, SessionDoc, SessionInfo } from "../../../../server/src/contract/protocol";
import type { ModelChoice } from "../../../../server/src/contract/provider-protocol";
import type { CommandUncertaintyKind } from "./session-presentation";
import { forgetViewChoice, Session } from "./session.svelte";
import { CommandFailed, CommandUncertainty, Transport } from "./transport";
import { ProviderClient } from "../settings/provider-client.svelte";
import { PersonaClient } from "../persona/persona-client.svelte";
const context = Symbol("session-client");

/** How many chats stay in memory as they were last shown, so opening one again shows it at once. */
const KEPT = 8;

/**
 * The app around the chats: the chat list, which chat is open, starting a new one, and PiSpark's
 * settings. Each chat that has been opened is a `Session`, which owns everything about it.
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
  /** How many sessions are archived, and which, once the Archived list has been opened. */
  archivedCount = $state(0);
  archived = $state<SessionInfo[]>();
  /** The open chat. */
  current = $state<Session>();
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
  private readonly opened = new Map<string, Session>();
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
      archived?: number;
    }>("/api/sessions");
    this.sessions = result.sessions;
    this.archivedCount = result.archived ?? 0;
    if (this.archived && this.archived.length !== this.archivedCount) void this.loadArchived();
    const apps = new Set(this.personas.items.filter((persona) => persona.home).map((persona) => persona.id));
    if (this.personas.items.length && result.sessions.some((session) => !!session.persona.home !== apps.has(session.persona.id)))
      void this.personas.refresh();
    for (const row of result.sessions) {
      const session = this.opened.get(row.id);
      if (session) session.row = row;
    }
    this.listNotice = result.truncated
      ? "Showing your latest 256 chats. Older chats are still saved."
      : "";
    if (result.unreadable) {
      this.listNotice = [this.listNotice, `${result.unreadable} chat records could not be read.`].filter(Boolean).join(" ");
    }
  }

  /** The chat's session object, kept from when it was last open or made now. */
  session(id: string): Session {
    let session = this.opened.get(id);
    if (!session) {
      session = new Session(id, this.transport, {
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
    this.opened.set(id, session);
    for (const [other, kept] of this.opened) {
      if (this.opened.size <= KEPT) break;
      if (kept !== this.current && kept !== session && !kept.draft) this.opened.delete(other);
    }
    session.row = this.sessions.find((s) => s.id === id) ?? session.row;
    return session;
  }
  /** Opens a chat: it shows at once as it was last seen, and the live stream brings it up to date. */
  async select(id: string) {
    const session = this.session(id);
    if (this.current !== session) this.current?.hide();
    this.current = session;
    try {
      localStorage.setItem("pispark-session", id);
    } catch { /* In-memory selection still works. */ }
    await session.show();
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
      if (receipt.error) throw new CommandFailed(receipt.error);
      const session = this.session(id);
      void this.transport.settled(receipt).catch((error) => {
        if (!this.disposed) session.fail(error);
      });
      window.location.hash = "/workspace";
      return true;
    } catch (error) {
      if (id) this.session(id).fail(error);
      else {
        this.fail(error);
        this.error = `New session: ${this.error}`;
      }
      return false;
    } finally {
      this.asking = false;
    }
  }
  /** The sessions of an app persona, newest first. */
  appSessions(persona: string): SessionInfo[] {
    return this.sessions
      .filter((session) => session.persona?.id === persona)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /**
   * Opens an app persona: its newest session or, with none (or when a fresh one is asked for), a
   * new one in the app's own place. No message is sent; the session shows the app's home view.
   */
  async openApp(persona: string, fresh = false): Promise<void> {
    const newest = fresh ? undefined : this.appSessions(persona)[0];
    if (newest) return this.select(newest.id);
    if (this.busy) return;
    this.asking = true;
    this.error = "";
    this.errorKind = undefined;
    try {
      const created = await this.transport.run({ type: "create", persona });
      await this.refresh();
      await this.select(created.sessionId!);
    } catch (error) {
      this.fail(error);
      this.error = `New session: ${this.error}`;
    } finally {
      this.asking = false;
    }
  }
  /** The archived sessions, newest first. */
  async loadArchived(): Promise<void> {
    const result = await this.transport.json<{ sessions: SessionInfo[] }>("/api/sessions?archived");
    this.archived = result.sessions.reverse();
  }
  /** Puts a session away: it unloads and leaves the list. If it was open, no session is. */
  archive(id: string): Promise<boolean> {
    return this.manage("archive", id);
  }
  restore(id: string): Promise<boolean> {
    return this.manage("restore", id);
  }
  /** Deletes an archived session for good. */
  delete(id: string): Promise<boolean> {
    return this.manage("delete", id);
  }
  private async manage(type: "archive" | "restore" | "delete", id: string): Promise<boolean> {
    this.error = "";
    this.errorKind = undefined;
    const open = this.opened.get(id);
    // The server closes an archived session's stream: stop following it first.
    if (type === "archive") open?.hide();
    try {
      await this.transport.run({ type, sessionId: id });
    } catch (error) {
      this.fail(error);
      if (open && open === this.current) void open.show();
      return false;
    }
    if (type !== "restore") {
      if (open === this.current) {
        this.current = undefined;
        try {
          localStorage.removeItem("pispark-session");
        } catch { /* Nothing was kept. */ }
      }
      this.opened.delete(id);
    }
    if (type === "delete") forgetViewChoice(id);
    await this.refresh();
    if (this.archived) await this.loadArchived();
    return true;
  }
  dispose() {
    this.providers.dispose();
    this.disposed = true;
    for (const session of this.opened.values()) session.hide();
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

const sessionContext = Symbol("chat-session");
/** Gives one chat to everything that draws it. */
export function provideSession(session: Session) {
  setContext(sessionContext, session);
  return session;
}
/** The chat this component is drawing. */
export function useSession(): Session {
  return getContext(sessionContext);
}
