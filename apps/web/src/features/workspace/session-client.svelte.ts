import { getContext, setContext } from "svelte";
import type { Catalog, HostSettings, SessionDoc, SessionInfo } from "../../../../server/src/contract/protocol";
import type { ModelChoice } from "../../../../server/src/contract/provider-protocol";
import type { CommandUncertaintyKind } from "./session-presentation";
import { forgetViewChoice, Session } from "./session.svelte";
import { CommandFailed, CommandUncertainty, Transport } from "./transport";
import { Attachments } from "./attachments.svelte";
import { ProviderClient } from "../settings/provider-client.svelte";
import { AgentClient } from "../agent/agent-client.svelte";
import { ScheduleClient } from "../schedules/schedule-client.svelte";
import { ProcessClient, RoutineClient } from "../background/background-client.svelte";
import { HostClient } from "../about/host-client.svelte";
const context = Symbol("session-client");

/** How many sessions stay in memory as they were last shown, so opening one again shows it at once. */
const KEPT = 8;

/**
 * The app around the sessions: the session list, which session is open, starting a new one, and PiSpark's
 * settings. Each session that has been opened is a `Session`, which owns everything about it.
 */
export class SessionClient {
  readonly providers = new ProviderClient();
  readonly agents = new AgentClient();
  catalog = $state<Catalog>({ home: "", recentFolders: [] });
  /** PiSpark's own settings; undefined until loaded. */
  settings = $state<HostSettings>();
  catalogLoading = $state(true);
  catalogError = $state(false);
  sessions = $state<SessionInfo[]>([]);
  /** How many sessions are archived, and which, once the Archived list has been opened. */
  archivedCount = $state(0);
  archived = $state<SessionInfo[]>();
  /** The open session. */
  current = $state<Session>();
  get selected(): string {
    return this.current?.id ?? "";
  }
  /** The server as a whole: "Loading", "Connected" or "Disconnected". */
  private backend = $state("Loading");
  /** What the shell shows: the open session's connection once the server is reached. */
  get connection(): string {
    return this.backend === "Connected" && this.current ? this.current.connection : this.backend;
  }
  error = $state("");
  errorKind = $state<CommandUncertaintyKind>();
  listNotice = $state("");
  /** A new session is being created. */
  private asking = $state(false);
  /** Something is being sent; the composers wait. */
  get busy(): boolean {
    return this.asking || !!this.current?.sending;
  }
  private readonly transport = new Transport();
  /** Every schedule, read with the session list. */
  readonly schedules = new ScheduleClient(this.transport);
  readonly routines = new RoutineClient(this.transport);
  readonly processes = new ProcessClient(this.transport);
  /** This PiSpark and its updates; after an update restart, the window reconnects by itself. */
  readonly host = new HostClient(this.transport, () => this.reconnect());
  /** Sessions that have been opened, least recently shown first. */
  private readonly opened = new Map<string, Session>();
  private disposed = false;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private mounting = false;
  private offline = () => this.current?.offline();
  private online = () => this.reconnect();
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.agents.unsaved) {
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
    void this.agents.refresh();
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
    void this.schedules.refresh().catch(() => {});
    void this.routines.refresh().catch(() => {});
    void this.processes.refresh().catch(() => {});
    void this.host.refresh().catch(() => {});
    if (this.archived && this.archived.length !== this.archivedCount) void this.loadArchived();
    const apps = new Set(this.agents.items.filter((agent) => agent.home).map((agent) => agent.id));
    if (this.agents.items.length && result.sessions.some((session) => !!session.agent.home !== apps.has(session.agent.id)))
      void this.agents.refresh();
    for (const row of result.sessions) {
      const session = this.opened.get(row.id);
      if (session) session.row = row;
    }
    this.listNotice = result.truncated
      ? "Showing your latest 256 sessions. Older sessions are still saved."
      : "";
    if (result.unreadable) {
      this.listNotice = [this.listNotice, `${result.unreadable} session records could not be read.`].filter(Boolean).join(" ");
    }
  }

  /** The Session object, kept from when it was last open or made now. */
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
    // Most recently used last. A session with an unsent draft is never dropped.
    this.opened.delete(id);
    this.opened.set(id, session);
    for (const [other, kept] of this.opened) {
      if (this.opened.size <= KEPT) break;
      if (kept !== this.current && kept !== session && !kept.draft) this.opened.delete(other);
    }
    session.row = this.sessions.find((s) => s.id === id) ?? session.row;
    return session;
  }
  /** Opens a session: it shows at once as it was last seen, and the live stream brings it up to date. */
  async select(id: string) {
    const session = this.session(id);
    if (this.current !== session) this.current?.hide();
    this.current = session;
    try {
      localStorage.setItem("pispark-session", id);
    } catch { /* In-memory selection still works. */ }
    await session.show();
  }
  /** Keep the session list's row in step with what the open session reports. */
  private track(id: string, session: SessionDoc) {
    const row = this.sessions.find((s) => s.id === id);
    const next = {
      title: session.title,
      hasHistory: session.hasHistory,
      status: session.status,
      interrupted: session.interrupted,
      agent: session.agent,
      agentChanged: session.agentChanged,
      waiting: session.waiting,
      queued: session.queued,
    };
    if (row && JSON.stringify(next) !== JSON.stringify({ title: row.title, hasHistory: row.hasHistory, status: row.status, interrupted: row.interrupted, agent: row.agent, agentChanged: row.agentChanged, waiting: row.waiting, queued: row.queued }))
      this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, ...next } : s));
  }
  /** Saves a settings change; rejects when the server refused it. */
  async saveSettings(settings: Partial<HostSettings>): Promise<void> {
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
  /** Starts a new session with a first message, in `folder` or, without one, in its project agent's. */
  /** Files added to Ask's draft. They wait in the browser: the session they belong to starts on Send. */
  readonly askAttachments = new Attachments();
  async ask(
    text: string,
    folder: string | undefined,
    model?: ModelChoice,
    agent?: string,
  ): Promise<boolean> {
    if (this.busy || !text.trim()) return false;
    const placed = this.askAttachments.placed(text);
    if (placed.length && this.askAttachments.blocked && !this.askAttachments.blocked.startsWith("Waiting")) {
      this.error = this.askAttachments.blocked;
      return false;
    }
    this.asking = true;
    this.error = "";
    this.errorKind = undefined;
    let id: string | undefined;
    try {
      const created = await this.transport.run({
        type: "create",
        ...(folder?.trim() ? { folder: folder.trim() } : {}),
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {}),
      });
      id = created.sessionId!;
      await this.refresh();
      // New recent folders for the picker.
      void this.transport
        .json<Catalog>("/api/catalog")
        .then((catalog) => (this.catalog = catalog))
        .catch(() => {});
      await this.select(id);
      // Ask's files go to the new session now, then the first message names them.
      if (placed.length && !(await this.askAttachments.uploadAll(placed, id)))
        throw new Error("An attachment could not be uploaded. Remove it, or try again.");
      const outgoing = placed.length ? this.askAttachments.outgoing(text) : { text, attachments: [] };
      const receipt = await this.transport.submit({
        type: "start",
        sessionId: id,
        text: outgoing.text,
        ...(outgoing.attachments.length ? { attachments: outgoing.attachments } : {}),
      });
      if (receipt.error) throw new CommandFailed(receipt.error);
      this.askAttachments.sent(placed);
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
  /** The sessions of an app agent, newest first. */
  appSessions(agent: string): SessionInfo[] {
    // A session another one started is listed under that one, not as one of the app's own.
    const listed = new Set(this.sessions.map((session) => session.id));
    return this.sessions
      .filter((session) => session.agent?.id === agent && !(session.parent && listed.has(session.parent)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /**
   * Opens an app agent: its newest session or, with none (or when a fresh one is asked for), a
   * new one in the app's own place. No message is sent; the session shows the app's home view.
   */
  async openApp(agent: string, fresh = false): Promise<void> {
    const newest = fresh ? undefined : this.appSessions(agent)[0];
    if (newest) return this.select(newest.id);
    if (this.busy) return;
    this.asking = true;
    this.error = "";
    this.errorKind = undefined;
    try {
      const created = await this.transport.run({ type: "create", agent });
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
  /** Stops a session's run, such as one this session started, without opening it. */
  async stop(id: string): Promise<boolean> {
    this.error = "";
    this.errorKind = undefined;
    try {
      await this.transport.run({ type: "cancel", sessionId: id });
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }
  /**
   * An extension asked to keep a session loaded: allow it (for the session's agent) or not now.
   * Or let go of a hold. The list is read again so the session's marks follow.
   */
  async hold(id: string, type: "allow-hold" | "deny-hold" | "release-hold"): Promise<boolean> {
    this.error = "";
    this.errorKind = undefined;
    try {
      await this.transport.run({ type, sessionId: id });
      await this.refresh();
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
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
    this.host.dispose();
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

const sessionContext = Symbol("session-session");
/** Gives one session to everything that draws it. */
export function provideSession(session: Session) {
  setContext(sessionContext, session);
  return session;
}
/** The session this component is drawing. */
export function useSession(): Session {
  return getContext(sessionContext);
}
