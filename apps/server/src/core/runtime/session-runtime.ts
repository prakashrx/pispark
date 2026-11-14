import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { Provider } from "@earendil-works/pi-ai";
import type { HostSettings, ItemsPage, LiveDoc, PartPage, SessionDoc } from "../../contract/protocol.js";
import type { ModelChoice } from "../../contract/provider-protocol.js";
import type { ChatPersona, PersonaSummary, PersonaTarget } from "../../contract/persona-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { homePaths } from "../home.js";
import { PersonaStore } from "../personas/store.js";
import { bindingOf, listPersonas, resolveSetup, unattendedOf, type Setup } from "../personas/resolve.js";
import { DEFAULT_PERSONA, validPersonaId } from "../personas/format.js";
import type { Json } from "../../contract/stream-ops.js";
import { Chat, extensionName, validateText, type ChatHost, type RunHandle, type RunResult, type SessionSummary } from "./chat.js";
import { toolChatTitle } from "./chat-title.js";
import type { SessionRequest } from "./session-tool.js";
import type { ReportMode, StatusDetails, WokenDetails } from "../../contract/wake-protocol.js";
import type { RuntimeConfiguration } from "./configuration.js";
import { deadline, RuntimeError, runtimeError } from "./errors.js";
import { readSettings, validSettings, writeSettings } from "./host-settings.js";
import type { LiveView } from "./live-view.js";
import type { SessionChange } from "./observation.js";
import type { ProviderSettings } from "./provider-settings.js";
import { validChoice } from "./provider-storage.js";
import { RunSlots } from "./run-slots.js";
import { ChatStorage, validateId } from "./storage.js";
import { Schedules } from "./schedules.js";
import { ToolDiscovery } from "./tool-discovery.js";
import { Wakes, type Wake } from "./wakes.js";
import type { Routine, RoutineList, RoutineRun, ScheduleInput, ScheduleList } from "../../contract/schedule-protocol.js";
import { switchName } from "../../contract/persona-protocol.js";
import { Routines } from "./routines.js";
import { Processes, type ProcessEnd } from "./processes.js";
import type { ProcessRequest } from "./process-tool.js";
import type { ProcessInfo, ProcessList, ProcessOutput } from "../../contract/process-protocol.js";
import type { RunningWork } from "../../contract/host-protocol.js";

type Stored = ReturnType<Processes["get"]>;

/** A child's result data as the parent's agent reads it, if it fits in `room` characters. */
function dataText(data: unknown, room: number): string {
  if (data === undefined) return "";
  for (const text of [JSON.stringify(data, null, 2), JSON.stringify(data)])
    if (text.length + 16 <= room) return `\n\nIts data:\n${text}`;
  return "\n\n(It also set data, too large to show here; this session's extensions received it.)";
}
import type { ChatMetadata } from "./storage.js";

/**
 * The chats this host holds, independent of clients: which are loaded, how many may run at once,
 * and when idle ones unload. Each loaded chat is a `Chat`, which owns its Pi session and lifecycle.
 * No HTTP, browser lifetime, terminal configuration or replay of interrupted tools.
 */
export class SessionRuntime {
  readonly personas: PersonaStore;
  private readonly tools: ToolDiscovery;
  private readonly storage: ChatStorage;
  private readonly live = new Map<string, Chat>();
  private readonly host: ChatHost;
  private accepting = true;
  private readonly unwatchPersonas: () => void;
  /** Loaded chats above which idle ones unload early; never a refusal. */
  private readonly maxLive: number;
  private readonly idleUnload: number;
  private readonly sweeper: ReturnType<typeof setInterval>;
  /** Chats whose agent works now, and the ones waiting for a turn. */
  private readonly slots: RunSlots;
  private readonly settingsPath: string;
  private readonly timeout: number;
  /**
   * What a chat says of its persona (name, home view) and which chats have their own layer. A
   * loaded chat's document is read on every streaming update, so these are read from disk once and
   * again only after a persona change.
   */
  private known?: Map<string, PersonaSummary>;
  private readonly appsDir: string;
  private readonly layered = new Map<string, boolean>();
  /** Delivery of every wake (whatever asks a session to work besides the person), and Pause all. */
  private readonly wakes: Wakes;
  /** The clock: every session's schedules, delivered as wakes. */
  private readonly schedules: Schedules;
  /** The routines personas offer, each run a new session of the persona. */
  private readonly routines: Routines;
  /** Commands sessions run in the background, owned here so they outlive an idle session. */
  private readonly processes: Processes;
  private unattendedPaused: boolean;
  private ticker?: ReturnType<typeof setInterval>;
  private checking?: Promise<void>;

  constructor(
    private readonly configuration: RuntimeConfiguration,
    private readonly providers?: ProviderSettings,
    private readonly logger: SafeLogger = silentLogger,
  ) {
    const paths = homePaths(configuration.home);
    this.tools = new ToolDiscovery(configuration.home);
    this.maxLive = configuration.maxLiveSessions ?? 32;
    this.idleUnload = configuration.idleUnloadMs ?? 15 * 60_000;
    this.settingsPath = paths.settings;
    this.appsDir = paths.apps;
    const stored = readSettings(this.settingsPath);
    this.slots = new RunSlots(configuration.maxRunning ?? stored.maxRunning);
    this.unattendedPaused = stored.unattendedPaused;
    this.timeout = configuration.operationTimeoutMs ?? 10_000;
    const runTimeout = configuration.runTimeoutMs ?? 300_000;
    if (![this.maxLive, this.timeout, runTimeout].every((value) => Number.isSafeInteger(value) && value > 0))
      throw new RuntimeError("configuration");
    this.storage = new ChatStorage(paths.chats);
    this.personas = new PersonaStore(paths.personas, paths.chats, (chatId) => this.storage.read(chatId).persona, logger);
    this.unwatchPersonas = this.personas.onChange(() => {
      this.known = undefined;
      this.layered.clear();
      this.checkSetups();
    });
    this.sweeper = setInterval(() => this.sweep(), Math.min(60_000, Math.max(1000, this.idleUnload / 4)));
    this.sweeper.unref();
    this.host = {
      storage: this.storage,
      slots: this.slots,
      logger,
      timeout: this.timeout,
      runTimeout,
      callTimeout: configuration.callTimeoutMs,
      points: configuration.points,
      accepting: () => this.accepting,
      holds: (chat) => this.live.get(chat.id) === chat,
      setup: (metadata) => resolveSetup(this.personas, this.target(metadata)),
      model: (metadata, setup) => this.model(metadata, setup),
      summary: (chat) => this.summary(chat.metadata, chat),
      released: (chat) => {
        if (this.live.get(chat.id) === chat) this.live.delete(chat.id);
        this.layered.delete(chat.id);
        if (!chat.published) this.storage.discardUnpublished(chat.id);
      },
      ended: (chat, result) => this.childEnded(chat, result),
      hold: (chat, request) => this.holdRequest(chat, request),
      toolsSeen: (fingerprint, paths, tools) => this.tools.remember(fingerprint, paths, tools),
      processes: { request: (sessionId, request, signal) => this.processRequest(sessionId, request, signal) },
      sessions: { request: (parentId, request) => this.sessionRequest(parentId, request) },
      // A waiting wake goes as soon as its session is free; the minute check catches anything missed.
      freed: () => {
        if (this.accepting) void this.wakes.drain();
      },
      schedules: {
        of: (sessionId) => this.schedules.of(sessionId),
        add: (sessionId, input, by) => this.schedules.add(sessionId, input, by),
        remove: (id) => this.schedules.remove(id),
      },
    };
    const sessions = {
      sessions: () => this.storage.list().map((metadata) => ({ id: metadata.id, archived: !!metadata.archived, child: !!metadata.parent })),
      ids: () => this.storage.ids(),
      directory: (id: string) => this.storage.directory(id),
    };
    this.wakes = new Wakes(
      {
        ...sessions,
        free: (id) => {
          const chat = this.live.get(id);
          return !chat || (chat.ready && chat.settled);
        },
        run: async (id, wake, details) => {
          this.admit();
          // A chat whose last run failed starts again from its transcript, as reopening it would.
          const chat = this.live.get(id);
          if (chat?.ready && chat.settled && chat.status === "error") await this.stop(id);
          await this.ensure(id);
          let text = wake.text;
          // A child's report: the session's extensions see it first and may take it or reword it.
          if (wake.report) {
            const answer = this.get(id).offerChildEnded(wake.report);
            if (answer?.action === "skip") return { handled: true as const };
            if (answer?.action === "send") text = answer.text;
          }
          validateText(text);
          return this.get(id).start(text, details);
        },
        paused: () => this.unattendedPaused,
      },
      { now: configuration.now, logger, settled: (sessionId, sourceId) => this.schedules.settled(sessionId, sourceId) },
    );
    this.schedules = new Schedules({ ...sessions, spawn: (owner, run) => this.spawnRun(owner, run) }, this.wakes, { now: configuration.now, logger });
    this.routines = new Routines(
      {
        personas: () => this.routinePersonas(),
        runs: (key) => this.runsOf(key),
        spawn: async (persona, run) => {
          const doc = await this.createSession({ persona }, { title: run.title, schedule: run.schedule });
          await this.pruneRuns(run.schedule.id, doc.id);
          return doc.id;
        },
      },
      this.wakes,
      { now: configuration.now, logger },
    );
    this.processes = new Processes(
      { ids: () => this.storage.ids(), directory: (id) => this.storage.directory(id), tell: (sessionId, end) => this.processEnded(sessionId, end) },
      { logger },
    );
    this.wakes.start();
    this.schedules.start();
    this.processes.load();
    // Processes that ended while PiSpark was stopped are told once everything is in place.
    setImmediate(() => this.processes.announce());
    const tickMs = configuration.wakeTickMs ?? 60_000;
    if (tickMs > 0) {
      this.ticker = setInterval(() => void this.checkWakes(), tickMs);
      this.ticker.unref();
      // What came due while PiSpark was off is looked at soon after it starts.
      setTimeout(() => void this.checkWakes(), Math.min(tickMs, 5000)).unref();
    }
  }

  // ---- Settings and the list ------------------------------------------------------------------

  /** PiSpark's own settings. */
  settings(): HostSettings {
    return { maxRunning: this.slots.max, unattendedPaused: this.unattendedPaused };
  }
  /** Saves a settings change; a new run limit applies at once (running chats keep running). */
  updateSettings(input: unknown): HostSettings {
    const settings = { ...this.settings(), ...validSettings(input) };
    writeSettings(this.settingsPath, settings);
    this.slots.setLimit(settings.maxRunning);
    this.unattendedPaused = settings.unattendedPaused;
    for (const chat of this.live.values()) chat.changed();
    void this.keepHeld();
    return this.settings();
  }
  /** The sessions in use; archived ones are left out. */
  list(): SessionSummary[] {
    return this.storage
      .list()
      .filter((metadata) => !metadata.archived)
      .map((metadata) => this.summary(metadata, this.live.get(metadata.id)));
  }
  /** The sessions the person put away. */
  archived(): SessionSummary[] {
    return this.storage
      .list()
      .filter((metadata) => metadata.archived)
      .map((metadata) => this.summary(metadata));
  }
  get unreadableSessions(): number {
    return this.storage.unreadable;
  }
  /** Recent distinct working folders, newest first, for Ask's folder picker. An app's own folder is its own. */
  recentFolders(limit = 8): string[] {
    const folders: string[] = [];
    let apps = this.appsDir;
    try {
      apps = realpathSync.native(apps);
    } catch {
      /* No app has a folder yet. */
    }
    const inApps = (folder: string) => {
      const path = relative(apps, folder);
      return !path.startsWith("..") && !isAbsolute(path);
    };
    for (const chat of this.storage.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      if (chat.cwd && !folders.includes(chat.cwd) && !inApps(chat.cwd)) {
        folders.push(chat.cwd);
        if (folders.length >= limit) break;
      }
    return folders;
  }
  private summary(metadata: ChatMetadata, chat?: Chat): SessionSummary {
    let layered = this.layered.get(metadata.id);
    if (layered === undefined) this.layered.set(metadata.id, (layered = this.personas.exists({ chat: metadata.id })));
    const known = (this.known ??= new Map(listPersonas(this.personas).map((p) => [p.id, p]))).get(metadata.persona);
    const persona: ChatPersona = {
      id: metadata.persona,
      name: known?.name ?? metadata.persona,
      layered,
      ...(known?.home ? { home: known.home } : {}),
    };
    return {
      id: metadata.id,
      folder: metadata.cwd,
      createdAt: metadata.createdAt,
      hasHistory: chat ? chat.hasHistory : this.storage.hasHistory(metadata.id),
      ...(metadata.title ? { title: metadata.title } : {}),
      status: chat?.status ?? "unloaded",
      interrupted: metadata.interrupted || (!chat && metadata.active),
      persona,
      ...(chat?.setupChanged ? { personaChanged: true } : {}),
      ...(chat?.asking ? { waiting: true } : {}),
      ...(chat?.waitingForSlot || (!chat && metadata.queued !== undefined) ? { queued: true } : {}),
      ...(metadata.parent ? { parent: metadata.parent } : {}),
      ...(metadata.schedule ? { schedule: { ...metadata.schedule } } : {}),
      ...(metadata.held ? { held: { ...metadata.held } } : {}),
      ...(this.processes?.runningIn(metadata.id) ? { processes: this.processes.runningIn(metadata.id) } : {}),
    };
  }
  /** The chat's own layer once it has one, else the persona it started with. */
  private target(metadata: ChatMetadata): PersonaTarget {
    return this.personas.exists({ chat: metadata.id }) ? { chat: metadata.id } : { persona: metadata.persona };
  }
  /** After any persona edit, flag open chats whose resolved setup no longer matches. */
  private checkSetups(): void {
    for (const chat of this.live.values()) {
      let fingerprint = "";
      try {
        fingerprint = resolveSetup(this.personas, this.target(chat.metadata)).fingerprint;
      } catch {
        /* An unresolvable persona counts as changed. */
      }
      chat.checkSetup(fingerprint);
    }
  }
  /** A chat keeps its model. A new chat: Ask's choice, else the persona's, else the default. */
  private async model(metadata: ChatMetadata, setup: Setup) {
    if (this.configuration.fixedModel) {
      const provider: Provider = this.configuration.fixedModel.provider();
      return { fixed: { provider, id: this.configuration.fixedModel.id } };
    }
    if (!this.providers) throw new RuntimeError("configuration");
    if (metadata.model) return { managed: await this.providers.select(metadata.model) };
    const preferred = setup.settings.model;
    const slash = preferred?.indexOf("/") ?? -1;
    if (preferred && slash > 0)
      try {
        return { managed: await this.providers.select({ provider: preferred.slice(0, slash), id: preferred.slice(slash + 1) }) };
      } catch {
        /* Not signed in to it: fall back to the default model. */
      }
    return { managed: await this.providers.select(undefined) };
  }

  // ---- Loading and unloading ------------------------------------------------------------------

  private get(id: string): Chat {
    validateId(id);
    const chat = this.live.get(id);
    if (!chat?.ready) throw new RuntimeError("not-found");
    return chat;
  }
  private admit(): void {
    if (!this.accepting) throw new RuntimeError("closed");
  }
  /** Unloads chats that have been idle for a while. */
  private sweep(): void {
    if (!this.accepting) return;
    const now = Date.now();
    for (const [id, chat] of this.live)
      if (chat.unloadable && !this.holding(chat.metadata) && now - chat.lastUsed >= this.idleUnload) void this.stop(id).catch(() => {});
  }
  /** Above the backstop, idle chats unload first, least recently used first. Nobody is refused. */
  private async makeRoom(): Promise<void> {
    while (this.live.size >= this.maxLive) {
      const idle = [...this.live.values()].filter((chat) => chat.unloadable && !this.holding(chat.metadata)).sort((a, b) => a.lastUsed - b.lastUsed);
      if (!idle.length) return;
      await this.stop(idle[0]!.id).catch(() => {});
    }
  }
  private load(metadata: ChatMetadata, reopening: boolean): Promise<SessionDoc> {
    const chat = new Chat(this.host, metadata, reopening);
    this.live.set(metadata.id, chat); // Reserve the chat before any async setup.
    return chat.load();
  }
  /**
   * A new session in the folder given, or in its persona's own place: a project persona's folder,
   * or an app persona's folder under the data root.
   */
  async create(request: { folder?: string; model?: ModelChoice; persona?: string }): Promise<SessionDoc> {
    if (!request || Object.keys(request).some((key) => key !== "folder" && key !== "model" && key !== "persona"))
      throw new RuntimeError("invalid-input");
    return this.createSession(request);
  }
  /** `create`, after its input is checked; a child session also names its parent. */
  private async createSession(
    request: { folder?: string; model?: ModelChoice; persona?: string },
    child: Pick<ChatMetadata, "parent" | "report" | "title" | "schedule"> = {},
  ): Promise<SessionDoc> {
    this.admit();
    // Only above the backstop is there anything to wait for; below it, admission stays immediate.
    if (this.live.size >= this.maxLive) {
      await this.makeRoom();
      this.admit();
    }
    if (request.model !== undefined && !validChoice(request.model)) throw new RuntimeError("invalid-input");
    const persona = request.persona ?? DEFAULT_PERSONA;
    if (!validPersonaId(persona)) throw new RuntimeError("invalid-input");
    if (!this.personas.exists({ persona })) throw new RuntimeError("persona");
    let bound: ReturnType<typeof bindingOf>;
    try {
      bound = bindingOf(this.personas, { persona });
    } catch {
      throw new RuntimeError("persona");
    }
    // A project persona decides the folder; nobody else may. An app without one has its own place
    // unless it is given another. Any other persona is given a folder.
    const folder = bound.folder ?? request.folder ?? (bound.home ? this.appFolder(persona) : undefined);
    if ((bound.folder && request.folder !== undefined) || typeof folder !== "string" || !isAbsolute(folder) || folder.length > 4096)
      throw new RuntimeError("invalid-input");
    // The folder is checked and made canonical during setup, after the chat is reserved.
    return this.load(
      {
        version: 2,
        id: randomUUID(),
        cwd: folder,
        persona,
        ...(request.model ? { model: request.model } : {}),
        createdAt: new Date().toISOString(),
        active: false,
        interrupted: false,
        ...child,
      },
      false,
    );
  }
  private appFolder(persona: string): string {
    const dir = join(this.appsDir, persona);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      throw new RuntimeError("storage");
    }
    return dir;
  }
  async open(id: string): Promise<SessionDoc> {
    validateId(id);
    if (this.live.has(id)) throw new RuntimeError("owned");
    this.admit();
    if (this.live.size >= this.maxLive) {
      await this.makeRoom();
      this.admit();
      if (this.live.has(id)) throw new RuntimeError("owned");
    }
    const metadata = this.storage.read(id);
    // An archived session is not opened until it is restored.
    if (metadata.archived) throw new RuntimeError("not-found");
    return this.load(metadata, true);
  }
  /** Loads a chat that is not loaded (or waits for one that is loading), so it can be sent to. */
  async ensure(id: string): Promise<void> {
    validateId(id);
    const chat = this.live.get(id);
    if (chat?.stopping) await chat.stopping.catch(() => {});
    else if (chat?.loading) {
      await chat.loading.catch(() => {});
      if (this.live.has(id)) return;
    } else if (chat) return;
    await this.open(id);
  }
  /** Restart a chat's Pi session from its transcript, picking up persona changes. */
  async reload(id: string): Promise<SessionDoc> {
    validateId(id);
    const chat = this.live.get(id);
    if (chat) {
      if (chat.loading || (chat.status !== "idle" && chat.status !== "error")) throw new RuntimeError("busy");
      await this.stop(id);
    }
    return this.open(id);
  }
  async stop(id: string): Promise<void> {
    validateId(id);
    const chat = this.live.get(id);
    if (!chat) throw new RuntimeError("not-found");
    if (chat.loading) {
      await deadline(chat.loading, this.timeout).catch((error: unknown) => {
        if (this.live.has(id)) throw error;
      });
      if (!this.live.has(id)) return;
    }
    await chat.stop();
  }
  /**
   * Puts a session away: it unloads and leaves the list. Refused while it runs, waits for an answer
   * or has a prompt waiting for its turn.
   */
  async archive(id: string): Promise<void> {
    validateId(id);
    // A parent takes its children along; nothing is put away while any of them works.
    const ids = [...this.childrenOf(id).filter((child) => !child.archived).map((child) => child.id), id];
    if (ids.some((each) => this.live.get(each) && !this.live.get(each)!.settled)) throw new RuntimeError("busy");
    for (const each of ids) {
      if (this.live.has(each)) await this.stop(each);
      const metadata = this.storage.read(each);
      if (metadata.queued !== undefined || this.live.has(each)) throw new RuntimeError("busy");
      const { held: _held, ...kept } = metadata;
      this.storage.write({ ...kept, archived: true });
      this.processes.stopSession(each);
    }
  }
  /** Brings a session back, with its children. */
  restore(id: string): void {
    validateId(id);
    for (const each of [id, ...this.childrenOf(id).map((child) => child.id)]) {
      const { archived, ...metadata } = this.storage.read(each);
      if (archived) this.storage.write(metadata);
    }
  }
  /** The sessions this one started. */
  private childrenOf(id: string): ChatMetadata[] {
    return this.storage.list().filter((metadata) => metadata.parent === id);
  }
  /**
   * Deletes an archived session for good, with everything in its folder. Its working folder, and
   * an app's own folder, are not its to remove.
   */
  delete(id: string): void {
    validateId(id);
    const metadata = this.storage.read(id);
    const children = this.childrenOf(id);
    if (!metadata.archived || [id, ...children.map((child) => child.id)].some((each) => this.live.has(each))) throw new RuntimeError("busy");
    for (const each of [...children.map((child) => child.id), id]) {
      this.storage.remove(each);
      this.layered.delete(each);
      this.schedules.forget(each);
      this.wakes.forget(each);
      this.processes.forget(each);
    }
    // A deleted child's reports are no longer kept by its parent.
    if (metadata.parent) this.wakes.forgetSource(metadata.parent, id);
  }

  /**
   * The tools a persona (or a chat's own layer) provides, found by loading its extensions without a
   * session. Nothing when the persona cannot be resolved; its view says why.
   */
  async discoverTools(target: PersonaTarget) {
    let setup: Setup;
    try {
      setup = resolveSetup(this.personas, target);
    } catch {
      return undefined;
    }
    return this.tools.tools(setup);
  }

  // ---- Child sessions -------------------------------------------------------------------------

  private now(): number {
    return this.configuration.now?.() ?? Date.now();
  }
  private titleOf(metadata: ChatMetadata): string {
    return metadata.title ?? "a session";
  }
  /** The session tool's requests (the agent's, or an extension's in that session): its own children only. */
  private async sessionRequest(parentId: string, request: SessionRequest): Promise<{ ok: boolean; text: string }> {
    const parent = this.storage.read(parentId);
    if (request.action === "report") return this.raise(parent, request.text);
    if (request.action === "start") return this.startChild(parent, request);
    if (request.action === "list") {
      const children = this.childrenOf(parentId);
      if (!children.length) return { ok: true, text: "This session has not started any sessions." };
      return { ok: true, text: children.map((child) => `${child.id}: ${this.titleOf(child)} (${this.childState(child)})`).join("\n") };
    }
    const child = this.childrenOf(parentId).find((each) => each.id === request.id);
    if (!child) return { ok: false, text: "This session did not start a session with that id (list shows them)." };
    if (request.action === "read") {
      if (child.archived) return { ok: false, text: "That session is archived." };
      await this.ensure(child.id);
      return { ok: true, text: this.get(child.id).lastReply() ?? "It has not answered yet." };
    }
    if (request.action === "stop") {
      const chat = this.live.get(child.id);
      if (!chat || chat.settled) return { ok: true, text: "It is not working." };
      await this.cancel(child.id);
      return { ok: true, text: "Stopped." };
    }
    if (child.archived) return { ok: false, text: "That session is archived." };
    this.admit();
    await this.ensure(child.id);
    validateText(request.text);
    try {
      void this.get(child.id).start(request.text, this.from(parent)).completion.catch(() => {});
    } catch (error) {
      if (runtimeError(error, "execution").code === "busy") return { ok: false, text: "It is still working; its answer will come back here." };
      throw error;
    }
    return { ok: true, text: "Sent." };
  }
  /** What a parent's message to its child says about where it came from. */
  private from(parent: ChatMetadata): WokenDetails {
    return { source: { kind: "session", id: parent.id, label: this.titleOf(parent) }, due: new Date(this.now()).toISOString() };
  }
  private childState(child: ChatMetadata): string {
    if (child.archived) return "archived";
    const chat = this.live.get(child.id);
    if (chat?.asking) return "waiting for the person";
    if (chat && !chat.settled) return "working";
    if (chat?.status === "error" || child.interrupted) return "failed";
    return "finished";
  }
  /**
   * A session started by another one: in the parent's folder (or its persona's own), with the
   * parent's persona and model unless another persona is named, and the parent's message first.
   * One level only: a child cannot start sessions.
   */
  private async startChild(parent: ChatMetadata, request: Extract<SessionRequest, { action: "start" }>) {
    if (parent.parent) return { ok: false, text: "A session started by another session cannot start sessions." };
    const persona = request.persona ?? parent.persona;
    if (!validPersonaId(persona) || !this.personas.exists({ persona })) return { ok: false, text: `There is no persona "${persona}".` };
    let ownFolder: boolean;
    try {
      ownFolder = !!bindingOf(this.personas, { persona }).folder;
    } catch {
      return { ok: false, text: `The persona "${persona}" cannot be used now.` };
    }
    validateText(request.prompt);
    let title: string | undefined;
    try {
      title = request.title ? toolChatTitle(request.title) : undefined;
    } catch {
      /* Named from its first message instead. */
    }
    const report = request.report ?? "result";
    const doc = await this.createSession(
      { ...(ownFolder ? {} : { folder: parent.cwd }), persona, ...(persona === parent.persona && parent.model ? { model: parent.model } : {}) },
      { parent: parent.id, ...(report !== "result" ? { report } : {}), ...(title ? { title } : {}) },
    );
    const chat = this.get(doc.id);
    void chat.start(request.prompt, this.from(parent)).completion.catch(() => {});
    const how = {
      result: "its answer arrives here as a message when it finishes.",
      status: "a line here says when it ends, and it raises anything that needs you.",
      none: "it does not report back (read shows its answer).",
    }[report];
    return { ok: true, text: `Started "${this.titleOf(chat.metadata)}" (id ${doc.id}). It works on its own; ${how}` };
  }
  /** The parent of a child, while it can be told something: listed and itself not a child. */
  private parentOf(child: ChatMetadata): ChatMetadata | undefined {
    if (!child.parent) return undefined;
    try {
      const parent = this.storage.read(child.parent);
      return parent.parent === undefined ? parent : undefined;
    } catch {
      return undefined;
    }
  }
  /** A child's run ended: its parent is told as the child's mode says. */
  private childEnded(chat: Chat, result: RunResult): void {
    const mode = chat.metadata.report ?? "result";
    const parent = this.parentOf(chat.metadata);
    if (!parent || mode === "none" || !this.accepting) return;
    const title = this.titleOf(chat.metadata);
    const how = result.outcome === "completed" ? "finished" : result.outcome === "cancelled" ? "stopped" : "failed";
    const answer = result.outcome === "completed" ? chat.lastReply() : undefined;
    const body = answer ? (answer.length > 8192 ? `${answer.slice(0, 8192)}…\n(cut; read shows all of it)` : answer) : `It ${how} without an answer.`;
    const data = chat.resultData;
    const report = { session: chat.id, title, how, mode, text: body, ...(data !== undefined ? { data } : {}) };
    if (mode === "status") return void this.statusLine(parent, report).catch((error: unknown) => {
      this.logger.event("wake.failure", { sessionId: parent.id, outcome: "failed", code: runtimeError(error, "execution").code });
    });
    void this.wakes.deliver(parent.id, {
      source: { kind: "session", id: chat.id, label: `${title} · ${how}` },
      text: `The session "${title}" you started ${how}:\n\n${body}${dataText(data, 56 * 1024 - body.length)}`,
      due: new Date(this.now()).toISOString(),
      policy: "queue",
      report,
    });
  }
  /**
   * Status mode: a line in the parent's conversation, without a turn. Its extensions see the end
   * first and may take it (no line) or turn it into a message that wakes the agent.
   */
  private async statusLine(parent: ChatMetadata, report: NonNullable<Wake["report"]>): Promise<void> {
    if (parent.archived) return;
    await this.ensure(parent.id);
    const chat = this.get(parent.id);
    const answer = chat.offerChildEnded(report);
    if (answer?.action === "skip") return;
    if (answer?.action === "send")
      return this.wakes.deliver(parent.id, {
        source: { kind: "session", id: report.session, label: `${report.title} · ${report.how}` },
        text: answer.text,
        due: new Date(this.now()).toISOString(),
        policy: "queue",
      });
    chat.addStatus(`The session "${report.title}" you started ${report.how}.`, { session: report.session, title: report.title, how: report.how });
  }
  /** A child in status mode raises something: its text wakes its parent, whose extensions see it first. */
  private raise(child: ChatMetadata, text: string): { ok: boolean; text: string } {
    const parent = this.parentOf(child);
    if (!parent || child.report !== "status") return { ok: false, text: "Only a session started by another one, in status mode, can raise things with it." };
    const title = this.titleOf(child);
    void this.wakes.deliver(parent.id, {
      source: { kind: "session", id: child.id, label: `${title} · raised` },
      text: `The session "${title}" you started raises this:\n\n${text}`,
      due: new Date(this.now()).toISOString(),
      policy: "queue",
      report: { session: child.id, title, how: "raised", mode: "status", text },
    });
    return { ok: true, text: "Raised with the session that started this one." };
  }

  // ---- Runs in a new session ------------------------------------------------------------------

  /** Runs of one schedule or routine kept in use; older ones are archived as new ones start. */
  private static readonly RUNS_KEPT = 10;
  /**
   * A schedule's run in its own session: a child of the owner, with the owner's persona, folder and
   * model, named for the run. The clock sends it the prompt.
   */
  private async spawnRun(owner: string, run: { title: string; report: ReportMode; schedule: { id: string; due: string } }): Promise<string> {
    const parent = this.storage.read(owner);
    if (parent.parent || parent.archived) throw new RuntimeError("busy");
    let ownFolder = false;
    try {
      ownFolder = !!bindingOf(this.personas, { persona: parent.persona }).folder;
    } catch {
      throw new RuntimeError("persona");
    }
    const doc = await this.createSession(
      { ...(ownFolder ? {} : { folder: parent.cwd }), persona: parent.persona, ...(parent.model ? { model: parent.model } : {}) },
      { parent: owner, title: run.title, schedule: run.schedule, ...(run.report !== "result" ? { report: run.report } : {}) },
    );
    await this.pruneRuns(run.schedule.id, doc.id);
    return doc.id;
  }
  /**
   * Keeps the newest runs of a schedule or routine in use: older ones that have settled and wait for
   * nobody are archived (and can be restored).
   */
  private async pruneRuns(schedule: string, keep: string): Promise<void> {
    const older = this.runsOf(schedule)
      .filter((run) => !run.archived && run.session !== keep)
      .slice(SessionRuntime.RUNS_KEPT - 1);
    for (const { session } of older) {
      const chat = this.live.get(session);
      if (chat && (!chat.settled || chat.asking)) continue;
      await this.archive(session).catch(() => {});
    }
  }

  // ---- Processes ------------------------------------------------------------------------------

  /** The sessions whose processes a session may see: its own and its children's. */
  private processSessions(sessionId: string): string[] {
    return [sessionId, ...this.childrenOf(sessionId).map((child) => child.id)];
  }
  /** The process tool's requests (the agent's, or an extension's in that session). */
  private async processRequest(sessionId: string, request: ProcessRequest, signal?: AbortSignal): Promise<{ ok: boolean; text: string }> {
    const metadata = this.storage.read(sessionId);
    const describe = (p: ProcessInfo) =>
      `${p.id}: ${p.title ? `${p.title} (${p.command})` : p.command} — ${
        p.state === "running" ? `running since ${p.startedAt}` : `${p.ended ? p.ended.replace("-", " ") : p.state}${p.exitCode !== undefined ? ` (exit ${p.exitCode})` : ""}`
      }${p.sessionId !== sessionId ? ` [started by ${this.titleOf(this.storage.read(p.sessionId))}]` : ""}`;
    const waited = async (process: Stored, wait: { waitFor?: string; timeoutSeconds?: number }, since: number) => {
      if (wait.waitFor === undefined) return "";
      let pattern: RegExp;
      try {
        pattern = new RegExp(wait.waitFor, "i");
      } catch {
        throw new RuntimeError("invalid-input");
      }
      const result = await this.processes.wait(process, pattern, since, wait.timeoutSeconds! * 1000, signal);
      // What follows the line it waited for (a server's URL after "ready") usually comes at once:
      // a moment more of output, until it goes quiet for a quarter second, at most half a second.
      if (result === "matched")
        for (const end = Date.now() + 500; Date.now() < end; ) {
          const before = process.written;
          await new Promise((done) => setTimeout(done, 250));
          if (process.written === before) break;
        }
      return { matched: `The output shows /${wait.waitFor}/.`, ended: "It ended before the output showed that.", timeout: `Not seen within ${wait.timeoutSeconds} s.` }[result] + "\n";
    };
    const output = (process: Stored) => {
      const out = this.processes.unread(process, sessionId);
      return `${out.cut ? "(older output was cut)\n" : ""}${out.text.trim() ? out.text : "(no new output)"}`;
    };
    switch (request.action) {
      case "start": {
        const folder = request.folder ? (isAbsolute(request.folder) ? request.folder : join(metadata.cwd, request.folder)) : metadata.cwd;
        const started = this.processes.start(sessionId, {
          command: request.command,
          folder,
          ...(request.title ? { title: request.title } : {}),
          report: request.report ?? "result",
          ...(request.stopAfterSeconds ? { stopAfterSeconds: request.stopAfterSeconds } : {}),
        });
        this.live.get(sessionId)?.changed();
        const process = this.processes.get(started.id, [sessionId]);
        // Its first output, or what it was asked to wait for.
        const note = request.waitFor !== undefined ? await waited(process, request, 0) : (await this.processes.wait(process, undefined, 0, 1000, signal), "");
        return { ok: true, text: `Started ${describe(this.processes.get(started.id, [sessionId]))} in ${folder}.\n${note}${output(process)}` };
      }
      case "list": {
        const all = this.processSessions(sessionId).flatMap((id) => this.processes.list(id));
        return { ok: true, text: all.length ? all.map(describe).join("\n") : "No processes." };
      }
      case "output": {
        const process = this.processes.get(request.id, this.processSessions(sessionId));
        const note = await waited(process, request, process.cursors[sessionId] ?? process.written);
        return { ok: true, text: `${describe(process)}\n${note}${output(process)}` };
      }
      case "watch":
      case "unwatch": {
        const process = this.processes.get(request.id, this.processSessions(sessionId));
        this.processes.watch(process, request.pattern, request.action === "unwatch" ? "remove" : (request.report ?? "result"));
        return { ok: true, text: request.action === "watch" ? `Watching for /${request.pattern}/; at most one wake a minute.` : "No longer watching that." };
      }
      case "stop": {
        const process = this.processes.get(request.id, this.processSessions(sessionId));
        if (process.state !== "running") return { ok: true, text: "It is not running." };
        this.processes.stop(process.id, "agent");
        await this.processes.wait(process, /(?!)/, process.written, 5000);
        if (this.processes.get(process.id, [process.sessionId]).state === "running") return { ok: true, text: "Stopping; it has not ended yet (list shows when it has)." };
        return { ok: true, text: "Stopped." };
      }
    }
  }
  /** A process ended (or a watch matched): its session is told as the mode says. */
  private processEnded(sessionId: string, end: ProcessEnd): void {
    this.live.get(sessionId)?.changed();
    if (end.mode === "none" || !this.accepting) return;
    let metadata: ChatMetadata;
    try {
      metadata = this.storage.read(sessionId);
    } catch {
      return;
    }
    if (metadata.archived) return;
    const title = end.process.title ?? end.process.command;
    const short = title.length > 80 ? `${title.slice(0, 79)}…` : title;
    if (end.mode === "status") {
      void this.statusIn(sessionId, `The process "${short}" ${end.how}.`, { process: end.process.id, title: short, how: end.how }).catch(() => {});
      return;
    }
    void this.wakes.deliver(sessionId, {
      source: { kind: "process", id: end.process.id, label: `${short} · ${end.how}`.slice(0, 200) },
      text: `The process "${short}" ${end.how}${end.watch ? `:\n${end.watch}` : "."}\n\nLast output:\n${end.tail.trim() || "(none)"}`,
      due: new Date(this.now()).toISOString(),
      policy: "queue",
    });
  }
  /** A status line in a session's conversation, loading it if needed. */
  private async statusIn(sessionId: string, text: string, details: StatusDetails): Promise<void> {
    await this.ensure(sessionId);
    this.get(sessionId).addStatus(text, details);
  }
  /** A session's processes, for clients. */
  listProcesses(sessionId: string): ProcessInfo[] {
    validateId(sessionId);
    this.storage.read(sessionId);
    return this.processes.list(sessionId);
  }
  /** What a restart would interrupt now: replies in progress and background processes. */
  runningWork(): RunningWork {
    const replies = this.list()
      .filter((s) => ["running", "queued", "stopping"].includes(s.status) || s.waiting || s.queued)
      .map((s) => ({ session: s.id, title: s.title ?? "New chat" }));
    const processes = this.runningProcesses().processes.map((p) => ({ session: p.sessionId, title: p.session.title ?? "New chat", name: p.title || p.command }));
    return { replies, processes };
  }
  /** Every process still running, with its session's title. */
  runningProcesses(): ProcessList {
    return {
      processes: this.processes.running().map((p) => {
        let title: string | undefined;
        try {
          title = this.storage.read(p.sessionId).title;
        } catch {
          /* Its session is gone. */
        }
        return { ...p, session: title ? { title } : {} };
      }),
    };
  }
  processOutput(sessionId: string, id: string, since: number): ProcessOutput {
    validateId(sessionId);
    if (!Number.isSafeInteger(since) || since < 0) throw new RuntimeError("invalid-input");
    return this.processes.read(this.processes.get(id, [sessionId]), since);
  }
  /** The person stops a process; its session is told. */
  stopProcess(sessionId: string, id: string): void {
    validateId(sessionId);
    this.processes.stop(this.processes.get(id, [sessionId]).id, "person");
  }

  // ---- Hold -----------------------------------------------------------------------------------

  /** Whether a session is kept loaded now: held, and not while unattended work is paused. */
  private holding(metadata: ChatMetadata): boolean {
    return !!metadata.held && !this.unattendedPaused;
  }
  /** The extension names a session's persona loads. */
  private extensionsOf(metadata: ChatMetadata): string[] {
    try {
      return resolveSetup(this.personas, this.target(metadata)).extensionPaths.map(extensionName);
    } catch {
      return [];
    }
  }
  /** Whether the session's persona allows the extension to hold (`hold:<extension>`). */
  private holdAllowed(metadata: ChatMetadata, extension: string): boolean {
    try {
      return unattendedOf(this.personas, this.target(metadata)).holds.includes(extension);
    } catch {
      return false;
    }
  }
  /**
   * An extension asks to keep its session loaded (or lets go). Allowed by the persona, it is held at
   * once; otherwise the person is asked in the chat (`holdAsked`) and the extension told so.
   */
  private holdRequest(chat: Chat, request: { extension: string; hold: boolean; reason: string }) {
    const metadata = chat.metadata;
    if (!request.hold) {
      if (chat.holdAsked?.extension === request.extension) chat.holdAsked = undefined;
      if (metadata.held?.extension === request.extension) {
        delete metadata.held;
        this.storage.write(metadata);
      }
      chat.changed();
      return { state: "released" as const, text: "Released: the session unloads when it is idle." };
    }
    if (!this.extensionsOf(metadata).includes(request.extension))
      return { state: "refused" as const, text: `This session has no extension called "${request.extension}".` };
    if (metadata.held && metadata.held.extension !== request.extension)
      return { state: "refused" as const, text: `"${metadata.held.extension}" already keeps this session loaded.` };
    if (!this.holdAllowed(metadata, request.extension)) {
      chat.holdAsked = { extension: request.extension, reason: request.reason };
      chat.changed();
      return { state: "asked" as const, text: "The person is asked to allow it; until then the session unloads when idle." };
    }
    chat.holdAsked = undefined;
    metadata.held = { extension: request.extension, reason: request.reason };
    this.storage.write(metadata);
    chat.changed();
    return { state: "held" as const, text: "Held: the session stays loaded while no one watches, and is loaded again after a restart." };
  }
  /**
   * The person answers a hold request: allowing it switches `hold:<extension>` on in the persona
   * (so its other sessions may hold too) and holds this session; "Not now" forgets the request.
   */
  answerHold(id: string, allow: unknown): void {
    if (typeof allow !== "boolean") throw new RuntimeError("invalid-input");
    const chat = this.get(id);
    const asked = chat.holdAsked;
    if (!asked) throw new RuntimeError("not-found");
    chat.holdAsked = undefined;
    if (allow) {
      this.setSwitch(chat.metadata.persona, switchName("hold", asked.extension), true);
      chat.metadata.held = { ...asked };
      this.storage.write(chat.metadata);
    }
    chat.changed();
  }
  /** The person lets go of a hold: the session unloads when idle. The persona still allows it. */
  releaseHold(id: string): void {
    validateId(id);
    const chat = this.live.get(id);
    const metadata = chat?.metadata ?? this.storage.read(id);
    if (!metadata.held) return;
    delete metadata.held;
    this.storage.write(metadata);
    chat?.changed();
  }
  /**
   * Held sessions as they should be: loaded (after a restart, or when Pause all ends), unloaded while
   * paused, and let go once their persona no longer allows it.
   */
  private async keepHeld(): Promise<void> {
    for (const metadata of this.storage.list()) {
      if (!metadata.held || metadata.archived || !this.accepting) continue;
      const chat = this.live.get(metadata.id);
      if (!this.holdAllowed(metadata, metadata.held.extension)) {
        const { held: _held, ...kept } = chat?.metadata ?? metadata;
        if (chat) delete chat.metadata.held;
        this.storage.write(chat?.metadata ?? kept);
        chat?.changed();
        continue;
      }
      try {
        if (this.unattendedPaused) {
          if (chat?.settled && chat.observers.size === 0) await this.stop(metadata.id);
        } else if (!chat) await this.ensure(metadata.id);
      } catch (error) {
        this.logger.event("wake.failure", { sessionId: metadata.id, outcome: "failed", code: runtimeError(error, "execution").code });
      }
    }
  }
  /** Turns a `type:name` switch on or off in a persona's own definition. */
  private setSwitch(persona: string, name: string, on: boolean): void {
    const { definition, revision } = this.personas.read({ persona });
    const without = (list?: string[]) => (list ?? []).filter((value) => value !== name);
    const next: typeof definition = { ...definition, on: [...without(definition.on), ...(on ? [name] : [])], off: [...without(definition.off), ...(on ? [] : [name])] };
    if (!next.on!.length) delete next.on;
    if (!next.off!.length) delete next.off;
    this.personas.save({ persona }, revision, next);
  }

  // ---- Routines -------------------------------------------------------------------------------

  /** Every persona that offers routines, with which are switched on. One that cannot be read offers none. */
  private routinePersonas() {
    return listPersonas(this.personas).flatMap((persona) => {
      if (!persona.valid) return [];
      try {
        const { routines } = unattendedOf(this.personas, { persona: persona.id });
        return routines.length ? [{ id: persona.id, name: persona.name, ...(persona.home ? { home: persona.home } : {}), routines }] : [];
      } catch {
        return [];
      }
    });
  }
  /** The sessions a schedule's or routine's runs made, newest first. */
  private runsOf(key: string): RoutineRun[] {
    return this.storage
      .list()
      .filter((metadata) => metadata.schedule?.id === key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((metadata) => ({
        session: metadata.id,
        due: metadata.schedule!.due,
        ...(metadata.title ? { title: metadata.title } : {}),
        ...(metadata.archived ? { archived: true as const } : {}),
      }));
  }
  listRoutines(): RoutineList {
    return { paused: this.unattendedPaused, routines: this.routines.list() };
  }
  /** Switches a routine on or off: an ordinary switch (`routine:<id>`) in the persona's own definition. */
  setRoutine(persona: string, id: string, on: unknown): Routine {
    if (!validPersonaId(persona) || typeof id !== "string" || typeof on !== "boolean") throw new RuntimeError("invalid-input");
    if (!this.routinePersonas().find((p) => p.id === persona)?.routines.some((r) => r.id === id)) throw new RuntimeError("not-found");
    this.setSwitch(persona, switchName("routine", id), on);
    if (on) this.routines.switchedOn(persona, id);
    return this.routines.list().find((r) => r.persona.id === persona && r.id === id)!;
  }
  /** Run now, with the person watching. */
  runRoutine(persona: string, id: string): Promise<void> {
    if (!this.accepting) throw new RuntimeError("closed");
    if (!validPersonaId(persona) || typeof id !== "string") throw new RuntimeError("invalid-input");
    return this.routines.runNow(persona, id);
  }

  // ---- Schedules ------------------------------------------------------------------------------

  /** Every schedule, with what a list needs of its session, and whether all are paused. */
  listSchedules(): ScheduleList {
    const sessions = new Map(this.storage.list().map((metadata) => [metadata.id, metadata]));
    return {
      paused: this.unattendedPaused,
      schedules: this.schedules.list().flatMap((schedule) => {
        const metadata = sessions.get(schedule.sessionId);
        if (!metadata) return [];
        const { title, persona } = this.summary(metadata, this.live.get(metadata.id));
        return [{ ...schedule, session: { ...(title ? { title } : {}), persona } }];
      }),
    };
  }
  /** A schedule the person added, to a session given by `sessionId`. */
  addSchedule(input: ScheduleInput) {
    if (!input || typeof input !== "object" || typeof input.sessionId !== "string") throw new RuntimeError("invalid-input");
    validateId(input.sessionId);
    const { sessionId, ...rest } = input;
    return this.schedules.add(sessionId, rest, "person");
  }
  updateSchedule(id: string, input: ScheduleInput) {
    return this.schedules.update(id, input);
  }
  removeSchedule(id: string): void {
    this.schedules.remove(id);
  }
  /** Run now, with the person watching; refused while the session is busy. */
  runSchedule(id: string): Promise<void> {
    if (!this.accepting) throw new RuntimeError("closed");
    return this.schedules.runNow(id);
  }
  /**
   * The minute check: the clock delivers what is due, then waiting wakes are looked at. Overlapping
   * calls share one pass.
   */
  checkWakes(): Promise<void> {
    if (!this.accepting) return Promise.resolve();
    return (this.checking ??= (async () => {
      await this.schedules.check();
      await this.routines.check();
      await this.keepHeld();
      await this.wakes.drain();
    })().finally(() => (this.checking = undefined)));
  }
  async shutdown(): Promise<void> {
    this.accepting = false;
    clearInterval(this.sweeper);
    if (this.ticker) clearInterval(this.ticker);
    this.unwatchPersonas();
    this.schedules.shutdown();
    const results = await Promise.allSettled([
      this.checking?.catch(() => {}).then(() => this.wakes.shutdown()) ?? this.wakes.shutdown(),
      this.personas.shutdown(),
      this.processes.shutdown(),
      ...[...this.live.keys()].map((id) => this.stop(id)),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw runtimeError(failed.reason, "execution");
  }

  // ---- One chat, by id ------------------------------------------------------------------------

  /** Everything about a chat except its history: status, model, queue and what extensions show. */
  session(id: string): SessionDoc {
    return this.get(id).doc();
  }
  /** The live document: session state, the items in flight and what running tools reported. */
  liveDoc(id: string): LiveDoc {
    return this.get(id).liveDoc();
  }
  /** Finalized items on the chat's active branch, read straight from Pi's session. */
  items(id: string, options: { before?: string; after?: string; limit?: number }): ItemsPage {
    return this.get(id).page(options);
  }
  image(id: string, itemId: string, part: number) {
    return this.get(id).image(itemId, part);
  }
  text(id: string, itemId: string, part: number, offset: number): PartPage {
    return this.get(id).text(itemId, part, offset);
  }
  /** A connection's live view of the chat, and the invalidations that say when to ask it for more. */
  observeLive(id: string): { view: LiveView; events: AsyncIterableIterator<SessionChange> & { close(): void } } {
    return this.get(id).observe();
  }
  /** An extension component's `host.call`: a function of its own placement, and its result. */
  call(id: string, point: string, key: string, name: string, data?: Json): Promise<Json | undefined> {
    return this.get(id).call(point, key, name, data);
  }
  /** An extension component's `host.file`: the path of a file in the folder its own placement named. */
  file(id: string, point: string, key: string, path: string): string {
    return this.get(id).file(point, key, path);
  }
  /** Answer a question an extension asked through Pi's `ctx.ui`. */
  answer(id: string, dialogId: string, answer: string | boolean | null): void {
    this.get(id).answer(dialogId, answer);
  }
  /** Send a prompt: it runs now if a run slot is free, else it waits for one. */
  start(id: string, text: string): RunHandle {
    validateText(text);
    if (!this.accepting) throw new RuntimeError("closed");
    return this.get(id).start(text);
  }
  /** Steer or follow up a running chat. */
  async queue(id: string, text: string, kind: "steer" | "follow-up"): Promise<"queued" | "handled"> {
    validateText(text);
    if (kind !== "steer" && kind !== "follow-up") throw new RuntimeError("invalid-input");
    return this.get(id).queue(text, kind);
  }
  cancel(id: string): Promise<void> {
    return this.get(id).cancel();
  }
}

export type { RuntimeConfiguration } from "./configuration.js";
export type { RunHandle, RunResult, SessionStatus, SessionSummary } from "./chat.js";
export { RuntimeError } from "./errors.js";
export type { SessionChange } from "./observation.js";
