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
import { bindingOf, listPersonas, resolveSetup, type Setup } from "../personas/resolve.js";
import { DEFAULT_PERSONA, validPersonaId } from "../personas/format.js";
import type { Json } from "../../contract/stream-ops.js";
import { Chat, validateText, type ChatHost, type RunHandle, type SessionSummary } from "./chat.js";
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
import { Wakes } from "./wakes.js";
import type { ScheduleInput, ScheduleList } from "../../contract/schedule-protocol.js";
import type { ChatMetadata } from "./storage.js";

/**
 * The chats this host holds, independent of clients: which are loaded, how many may run at once,
 * and when idle ones unload. Each loaded chat is a `Chat`, which owns its Pi session and lifecycle.
 * No HTTP, browser lifetime, terminal configuration or replay of interrupted tools.
 */
export class SessionRuntime {
  readonly personas: PersonaStore;
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
  private unattendedPaused: boolean;
  private ticker?: ReturnType<typeof setInterval>;
  private checking?: Promise<void>;

  constructor(
    private readonly configuration: RuntimeConfiguration,
    private readonly providers?: ProviderSettings,
    private readonly logger: SafeLogger = silentLogger,
  ) {
    const paths = homePaths(configuration.home);
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
      sessions: () => this.storage.list().map((metadata) => ({ id: metadata.id, archived: !!metadata.archived })),
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
        run: async (id, text, details) => {
          this.admit();
          // A chat whose last run failed starts again from its transcript, as reopening it would.
          const chat = this.live.get(id);
          if (chat?.ready && chat.settled && chat.status === "error") await this.stop(id);
          await this.ensure(id);
          validateText(text);
          return this.get(id).start(text, details);
        },
        paused: () => this.unattendedPaused,
      },
      { now: configuration.now, logger, settled: (sessionId, sourceId) => this.schedules.settled(sessionId, sourceId) },
    );
    this.schedules = new Schedules(sessions, this.wakes, { now: configuration.now, logger });
    this.wakes.start();
    this.schedules.start();
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
      if (chat.unloadable && now - chat.lastUsed >= this.idleUnload) void this.stop(id).catch(() => {});
  }
  /** Above the backstop, idle chats unload first, least recently used first. Nobody is refused. */
  private async makeRoom(): Promise<void> {
    while (this.live.size >= this.maxLive) {
      const idle = [...this.live.values()].filter((chat) => chat.unloadable).sort((a, b) => a.lastUsed - b.lastUsed);
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
    this.admit();
    // Only above the backstop is there anything to wait for; below it, admission stays immediate.
    if (this.live.size >= this.maxLive) {
      await this.makeRoom();
      this.admit();
    }
    if (!request || Object.keys(request).some((key) => key !== "folder" && key !== "model" && key !== "persona"))
      throw new RuntimeError("invalid-input");
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
    const chat = this.live.get(id);
    if (chat && !chat.settled) throw new RuntimeError("busy");
    if (chat) await this.stop(id);
    const metadata = this.storage.read(id);
    if (metadata.queued !== undefined || this.live.has(id)) throw new RuntimeError("busy");
    this.storage.write({ ...metadata, archived: true });
  }
  restore(id: string): void {
    validateId(id);
    const { archived, ...metadata } = this.storage.read(id);
    if (archived) this.storage.write(metadata);
  }
  /**
   * Deletes an archived session for good, with everything in its folder. Its working folder, and
   * an app's own folder, are not its to remove.
   */
  delete(id: string): void {
    validateId(id);
    if (!this.storage.read(id).archived || this.live.has(id)) throw new RuntimeError("busy");
    this.storage.remove(id);
    this.layered.delete(id);
    this.schedules.forget(id);
    this.wakes.forget(id);
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
