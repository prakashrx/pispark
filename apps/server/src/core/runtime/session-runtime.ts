import { DependencyPreparationError } from "./extension-dependencies.js";
import type { ThinkingLevel } from "../../contract/agent-protocol.js";
import { sessionTitle } from "../../contract/session-title.js";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { constants, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import type { HostSettings, ItemsPage, LiveDoc, PartPage, SessionDoc, SessionFile } from "../../contract/protocol.js";
import type { SessionAgent, AgentSummary, AgentTarget } from "../../contract/agent-protocol.js";
import type { ModelChoice } from "../../contract/provider-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { homePaths } from "../home.js";
import { AgentStore } from "../agents/store.js";
import { bindingOf, listAgents, resolveSetup, type Setup } from "../agents/resolve.js";
import { DEFAULT_AGENT, validAgentId } from "../agents/format.js";
import type { Json } from "../../contract/stream-ops.js";
import { Session, validateText, type SessionHost, type RunHandle, type SessionSummary } from "./session.js";
import type { RuntimeConfiguration } from "./configuration.js";
import { deadline, RuntimeError, runtimeError } from "./errors.js";
import { readSettings, validSettings, writeSettings } from "./host-settings.js";
import type { LiveView } from "./live-view.js";
import type { SessionChange } from "./observation.js";
import type { ProviderSettings } from "./provider-settings.js";
import { validChoice } from "./provider-storage.js";
import { RunSlots } from "./run-slots.js";
import { SessionStorage, validateId, type SessionMetadata } from "./storage.js";
import { attachmentPath, filesFolder, forkAttachmentTags, placeAttachments, saveAttachment, sentAttachmentNames, uploadedNames, validAttachmentName } from "./attachments.js";
import { Schedules } from "./schedules.js";
import { ToolDiscovery } from "./tool-discovery.js";
import { Wakes } from "./wakes.js";
import type { Routine, RoutineList, ScheduleInput, ScheduleList } from "../../contract/schedule-protocol.js";
import { switchName } from "../../contract/agent-protocol.js";
import { Routines } from "./routines.js";
import { Processes } from "./processes.js";
import type { ProcessInfo, ProcessList, ProcessOutput } from "../../contract/process-protocol.js";
import type { RunningWork } from "../../contract/host-protocol.js";
import { targetOf, type NewSession, type Origin, type SessionAccess } from "./session-access.js";
import { Children } from "./children.js";
import { Holds } from "./holds.js";
import { Runs } from "./runs.js";
import { SessionProcesses } from "./session-processes.js";


/**
 * The sessions this host holds, independent of clients: which are loaded, how many may run at once,
 * and when idle ones unload. Each loaded session is a `Session`, which owns its Pi session and lifecycle.
 * No HTTP, browser lifetime, terminal configuration or replay of interrupted tools.
 */
const THINKING: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export class SessionRuntime {
  readonly agents: AgentStore;
  private readonly tools: ToolDiscovery;
  private readonly storage: SessionStorage;
  private readonly live = new Map<string, Session>();
  private readonly host: SessionHost;
  private accepting = true;
  private readonly unwatchAgents: () => void;
  /** Loaded sessions above which idle ones unload early; never a refusal. */
  private readonly maxLive: number;
  private readonly idleUnload: number;
  private readonly sweeper: ReturnType<typeof setInterval>;
  /** Sessions whose agent works now, and the ones waiting for a turn. */
  private readonly slots: RunSlots;
  private readonly settingsPath: string;
  private readonly timeout: number;
  /**
   * What a session says of its agent (name, home view) and which sessions have their own layer. A
   * loaded session's document is read on every streaming update, so these are read from disk once and
   * again only after an agent change.
   */
  private known?: Map<string, AgentSummary>;
  private readonly touchedListeners = new Set<() => void>();
  /** Called whenever a loaded session changes (often; keep it cheap). Returns the unsubscribe. */
  onTouched(listener: () => void): () => void {
    this.touchedListeners.add(listener);
    return () => this.touchedListeners.delete(listener);
  }
  private readonly appsDir: string;
  private readonly layered = new Map<string, boolean>();
  /** Delivery of every wake (whatever asks a session to work besides the person), and Pause all. */
  private readonly wakes: Wakes;
  /** The clock: every session's schedules, delivered as wakes. */
  private readonly schedules: Schedules;
  /** The routines agents offer, each run a new session of the agent. */
  private readonly routines: Routines;
  /** Commands sessions run in the background, owned here so they outlive an idle session. */
  private readonly processes: Processes;
  private unattendedPaused: boolean;
  private ticker?: ReturnType<typeof setInterval>;
  private checking?: Promise<void>;
  /** Sessions started by other sessions. */
  private readonly children: Children;
  /** Extensions keeping their sessions loaded. */
  private readonly holds: Holds;
  /** Runs of schedules and routines, each in a new session. */
  private readonly runs: Runs;
  /** Background processes as sessions and clients see them. */
  private readonly sessionProcesses: SessionProcesses;

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
    if (![this.maxLive, this.timeout].every((value) => Number.isSafeInteger(value) && value > 0))
      throw new RuntimeError("configuration");
    this.storage = new SessionStorage(paths.sessions);
    this.agents = new AgentStore(paths.agents, paths.sessions, (sessionId) => this.storage.read(sessionId).agent, logger);
    this.unwatchAgents = this.agents.onChange(() => {
      this.known = undefined;
      this.layered.clear();
      this.checkSetups();
    });
    const access: SessionAccess = {
      storage: this.storage,
      agents: this.agents,
      logger,
      accepting: () => this.accepting,
      admit: () => this.admit(),
      now: () => configuration.now?.() ?? Date.now(),
      live: (id) => this.live.get(id),
      get: (id) => this.get(id),
      ensure: (id) => this.ensure(id),
      stop: (id) => this.stop(id),
      cancel: (id) => this.get(id).cancel("parent-request"),
      archive: (id) => this.archive(id),
      create: (request, origin) => this.createSession(request, origin),
      deliver: (id, wake) => this.wakes.deliver(id, wake),
    };
    this.children = new Children(access);
    this.holds = new Holds(access, () => this.unattendedPaused);
    this.runs = new Runs(access);
    this.sweeper = setInterval(() => this.sweep(), Math.min(60_000, Math.max(1000, this.idleUnload / 4)));
    this.sweeper.unref();
    this.host = {
      storage: this.storage,
      slots: this.slots,
      logger,
      timeout: this.timeout,
      callTimeout: configuration.callTimeoutMs,
      points: configuration.points,
      accepting: () => this.accepting,
      holds: (session) => this.live.get(session.id) === session,
      setup: (metadata) => resolveSetup(this.agents, this.target(metadata)),
      model: (metadata, setup) => this.model(metadata, setup),
      summary: (session) => this.summary(session.metadata, session),
      released: (session) => {
        if (this.live.get(session.id) === session) {
          this.live.delete(session.id);
          this.extensionReloads.delete(session.id);
        }
        this.layered.delete(session.id);
        if (!session.published) this.storage.discardUnpublished(session.id);
      },
      ended: (session, result) => this.children.ended(session, result),
      hold: (session, request) => this.holds.request(session, request),
      toolsSeen: (fingerprint, paths, tools) => this.tools.remember(fingerprint, paths, tools),
      processes: { request: (sessionId, request, signal) => this.sessionProcesses.request(sessionId, request, signal) },
      sessions: { request: (parentId, request) => this.children.request(parentId, request) },
      // A waiting wake goes as soon as its session is free; the minute check catches anything missed.
      extensionPending: (id) => this.extensionReloads.get(id) ?? this.extensionCandidates.get(id)?.revision,
      extensionCandidate: (id) => this.extensionCandidates.get(id)?.active,
      extensionReload: (session, revision) => {
        if (!this.accepting || this.live.get(session.id) !== session || this.wakes.waiting(session.id)) return false;
        this.extensionReloads.set(session.id, revision);
        return true;
      },
      freed: (session) => {
        if (!this.accepting) return;
        void this.applyExtensionReload(session).finally(() => this.wakes.drain()).catch(() => {});
      },
      touched: () => {
        for (const listener of this.touchedListeners) listener();
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
          const session = this.live.get(id);
          return !this.extensionReloads.has(id) && !this.extensionCandidates.has(id) && (!session || (session.ready && session.settled));
        },
        run: async (id, wake, details) => {
          this.admit();
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
    this.schedules = new Schedules({ ...sessions, spawn: (owner, run) => this.runs.schedule(owner, run) }, this.wakes, { now: configuration.now, logger });
    this.routines = new Routines(
      {
        agents: () => this.runs.routineAgents(),
        runs: (key) => this.runs.of(key),
        spawn: (agent, run) => this.runs.routine(agent, run),
      },
      this.wakes,
      { now: configuration.now, logger },
    );
    this.processes = new Processes(
      { ids: () => this.storage.ids(), directory: (id) => this.storage.directory(id), tell: (sessionId, end) => this.sessionProcesses.ended(sessionId, end) },
      { logger },
    );
    this.sessionProcesses = new SessionProcesses(access, this.processes, (id) => this.children.of(id));
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
  /** Saves a settings change; a new run limit applies at once (running sessions keep running). */
  updateSettings(input: unknown): HostSettings {
    const settings = { ...this.settings(), ...validSettings(input) };
    writeSettings(this.settingsPath, settings);
    this.slots.setLimit(settings.maxRunning);
    this.unattendedPaused = settings.unattendedPaused;
    for (const session of this.live.values()) session.changed();
    void this.holds.keep();
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
  /** Recent distinct working folders, newest first, for the New session folder picker. An app's own folder is its own. */
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
    for (const session of this.storage.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      if (session.cwd && !folders.includes(session.cwd) && !inApps(session.cwd)) {
        folders.push(session.cwd);
        if (folders.length >= limit) break;
      }
    return folders;
  }
  private summary(metadata: SessionMetadata, session?: Session): SessionSummary {
    let layered = this.layered.get(metadata.id);
    if (layered === undefined) this.layered.set(metadata.id, (layered = this.agents.exists({ session: metadata.id })));
    const known = (this.known ??= new Map(listAgents(this.agents).map((p) => [p.id, p]))).get(metadata.agent);
    const agent: SessionAgent = {
      id: metadata.agent,
      name: known?.name ?? metadata.agent,
      layered,
      ...(known?.home ? { home: known.home } : {}),
    };
    return {
      id: metadata.id,
      folder: metadata.cwd,
      createdAt: metadata.createdAt,
      lastActivity: this.storage.lastActivity(metadata),
      hasHistory: session ? session.hasHistory : this.storage.hasHistory(metadata.id),
      ...(metadata.title ? { title: metadata.title } : {}),
      status: session?.status ?? "unloaded",
      interrupted: metadata.interrupted || (!session && metadata.active),
      agent,
      ...(session?.setupChanged ? { agentChanged: true } : {}),
      ...(session?.asking ? { waiting: true } : {}),
      ...(session?.question ? { question: session.question } : {}),
      ...(metadata.seenAt && this.storage.lastActivity(metadata) > metadata.seenAt ? { unread: true } : {}),
      ...(session?.workingSince ? { workingSince: new Date(session.workingSince).toISOString() } : {}),
      ...(session?.waitingForSlot || (!session && metadata.queued !== undefined) ? { queued: true } : {}),
      ...(metadata.forkOf ? { parent: metadata.forkOf, forkOf: metadata.forkOf }
        : metadata.parent ? { parent: metadata.parent } : {}),
      ...(metadata.schedule ? { schedule: { ...metadata.schedule } } : {}),
      ...(metadata.held ? { held: { ...metadata.held } } : {}),
      ...(this.processes?.runningIn(metadata.id) ? { processes: this.processes.runningIn(metadata.id) } : {}),
      ...(session?.readOnly ? { readOnly: session.readOnly } : {}),
    };
  }
  private target(metadata: SessionMetadata): AgentTarget {
    return targetOf(this.agents, metadata);
  }
  /** After any agent edit, flag open sessions whose resolved setup no longer matches. */
  private checkSetups(): void {
    for (const session of this.live.values()) {
      let fingerprint = "";
      try {
        fingerprint = resolveSetup(this.agents, this.target(session.metadata)).fingerprint;
      } catch {
        /* An unresolvable agent counts as changed. */
      }
      session.checkSetup(fingerprint);
    }
  }
  /** A session keeps its model. A new session: the choice made when starting it, else the agent's, else the default. */
  private async model(metadata: SessionMetadata, setup: Setup) {
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

  private get(id: string): Session {
    validateId(id);
    const session = this.live.get(id);
    if (!session?.ready) throw new RuntimeError("not-found");
    return session;
  }
  private admit(): void {
    if (!this.accepting) throw new RuntimeError("closed");
  }
  /** Unloads sessions that have been idle for a while. */
  private sweep(): void {
    if (!this.accepting) return;
    const now = Date.now();
    for (const [id, session] of this.live)
      if (session.unloadable && !this.holds.holding(session.metadata) && now - session.lastUsed >= this.idleUnload) void this.stop(id).catch(() => {});
  }
  /** Above the backstop, idle sessions unload first, least recently used first. Nobody is refused. */
  private async makeRoom(): Promise<void> {
    while (this.live.size >= this.maxLive) {
      const idle = [...this.live.values()].filter((session) => session.unloadable && !this.holds.holding(session.metadata)).sort((a, b) => a.lastUsed - b.lastUsed);
      if (!idle.length) return;
      await this.stop(idle[0]!.id).catch(() => {});
    }
  }
  private load(metadata: SessionMetadata, reopening: boolean): Promise<SessionDoc> {
    const session = new Session(this.host, metadata, reopening);
    this.live.set(metadata.id, session); // Reserve the session before any async setup.
    return session.load();
  }
  /**
   * A new session in the folder given, or in its agent's own place: a project agent's folder,
   * or an app agent's folder under the data root.
   */
  async create(request: NewSession): Promise<SessionDoc> {
    if (!request || Object.keys(request).some((key) => key !== "folder" && key !== "model" && key !== "agent"))
      throw new RuntimeError("invalid-input");
    return this.createSession(request);
  }
  /** `create`, after its input is checked; a child session also names its parent. */
  private async createSession(request: NewSession, child: Origin = {}): Promise<SessionDoc> {
    this.admit();
    // Only above the backstop is there anything to wait for; below it, admission stays immediate.
    if (this.live.size >= this.maxLive) {
      await this.makeRoom();
      this.admit();
    }
    if (request.model !== undefined && !validChoice(request.model)) throw new RuntimeError("invalid-input");
    const agent = request.agent ?? DEFAULT_AGENT;
    if (!validAgentId(agent)) throw new RuntimeError("invalid-input");
    if (!this.agents.exists({ agent })) throw new RuntimeError("agent");
    let bound: ReturnType<typeof bindingOf>;
    try {
      bound = bindingOf(this.agents, { agent });
    } catch {
      throw new RuntimeError("agent");
    }
    // A project agent decides the folder; nobody else may. An app without one has its own place
    // unless it is given another. Any other agent is given a folder.
    const folder = bound.folder ?? request.folder ?? (bound.home ? this.appFolder(agent) : undefined);
    if ((bound.folder && request.folder !== undefined) || typeof folder !== "string" || !isAbsolute(folder) || folder.length > 4096)
      throw new RuntimeError("invalid-input");
    // The folder is checked and made canonical during setup, after the session is reserved.
    const createdAt = new Date().toISOString();
    return this.load(
      {
        version: 2,
        id: randomUUID(),
        tracksUploads: true,
        cwd: folder,
        agent,
        ...(request.model ? { model: request.model } : {}),
        createdAt,
        // Nothing to read yet: it becomes unread when it does something no one has looked at.
        seenAt: createdAt,
        active: false,
        interrupted: false,
        ...child,
      },
      false,
    );
  }
  private appFolder(agent: string): string {
    const dir = join(this.appsDir, agent);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      throw new RuntimeError("storage");
    }
    return dir;
  }
  async open(id: string): Promise<SessionDoc> {
    return this.openCurrent(id);
  }
  private async openCurrent(id: string, extensionRevision?: string): Promise<SessionDoc> {
    validateId(id);
    const candidate = this.extensionCandidates.get(id);
    if (candidate && candidate.revision !== extensionRevision) throw new RuntimeError("busy");
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
  /** Loads a session that is not loaded (or waits for one that is loading), so it can be sent to. */
  async ensure(id: string): Promise<void> {
    validateId(id);
    const session = this.live.get(id);
    if (session?.stopping) await session.stopping.catch(() => {});
    else if (session?.loading) {
      await session.loading.catch(() => {});
      if (this.live.has(id)) return;
    } else if (session && !((session.readOnly || session.status === "error") && session.settled)) return;
    // A read-only session gets a full open again: what it lacked may be back. A session whose last
    // run failed starts again from its transcript, as reopening it would, so the next message goes.
    else if (session) await this.stop(id);
    await this.open(id);
  }
  /**
   * Restart a session's Pi session from its transcript, picking up agent changes. With a model, the
   * session runs that one from now on (how a read-only session whose model is gone goes on).
   */
  async reload(id: string, model?: ModelChoice): Promise<SessionDoc> {
    return this.reloadCurrent(id, model);
  }
  private async reloadCurrent(id: string, model?: ModelChoice, extensionRevision?: string): Promise<SessionDoc> {
    validateId(id);
    if (this.extensionReloads.has(id) || this.extensionCandidates.get(id)?.revision !== extensionRevision)
      throw new RuntimeError("busy");
    if (model !== undefined && !validChoice(model)) throw new RuntimeError("invalid-input");
    const session = this.live.get(id);
    if (session) {
      if (session.loading || !["idle", "error", "read-only"].includes(session.status)) throw new RuntimeError("busy");
      await this.stop(id);
    }
    if (model) {
      const metadata = this.storage.read(id);
      if (metadata.archived) throw new RuntimeError("not-found");
      this.storage.write({ ...metadata, model: { provider: model.provider, id: model.id } });
    }
    return this.openCurrent(id, extensionRevision);
  }
  private readonly extensionReloads = new Map<string, string>();
  private readonly extensionCandidates = new Map<string, { revision: string; active: import("./extension-revisions.js").ExtensionChange[] }>();
  private async applyExtensionReload(session: Session): Promise<void> {
    const { id, extensionRevisions: revisions } = session;
    const revision = this.extensionReloads.get(id);
    if (!revision || this.live.get(id) !== session || !session.settled) return;
    const before = revisions.read();
    const change = before.staged;
    const report = (state: typeof before, outcome: string, failed: boolean) => {
      revisions.write({ ...state, outcome });
      this.live.get(id)?.extensionReloadNotice(outcome, failed);
    };
    const superseded = () => this.live.get(id) !== session || !this.accepting || this.wakes.waiting(id) || session.metadata.queued !== undefined || session.extensionReloadCancelled;
    if (change?.revision !== revision || superseded()) {
      this.extensionReloads.delete(id);
      report(before, "The extension change was skipped because the session or the staged revision changed.", true);
      return;
    }
    try {
      revisions.verify(change);
      await revisions.prepare(change);
    } catch (error) {
      this.extensionReloads.delete(id);
      const reason = error instanceof DependencyPreparationError ? error.message : "The staged files could not be prepared.";
      report(before, "Could not apply " + change.name + ". " + reason, true);
      return;
    }
    this.extensionReloads.delete(id);
    if (superseded() || revisions.read().staged?.revision !== revision) {
      report(before, "The extension change was skipped because the session or the staged revision changed during preparation.", true);
      return;
    }
    const prior = before.active.find((item) => item.name === change.name);
    const next = { active: [...before.active.filter((item) => item.name !== change.name), ...(change.snapshot ? [change] : [])] };
    try {
      this.extensionCandidates.set(id, { revision, ...next });
      const doc = await this.reloadCurrent(id, undefined, revision);
      if (doc.status !== "idle") throw new RuntimeError("extension");
      report(next, `Reloaded revision ${revision}: ${change.snapshot ? `loaded ${change.name}` : `removed ${change.name}`}.`, false);
    } catch (error) {
      this.extensionCandidates.delete(id);
      const outcome = `Reload ${revision} failed (${runtimeError(error, "extension").code}); previous selection restored.`;
      report(before, outcome, true);
      if (this.accepting) {
        try { await this.reload(id); this.live.get(id)?.extensionReloadNotice(outcome, true); }
        catch { report(before, `${outcome} Could not reopen the session.`, true); }
      }
      return;
    } finally { this.extensionCandidates.delete(id); }
    revisions.prune(prior?.snapshot);
  }
  async stop(id: string): Promise<void> {
    validateId(id);
    const session = this.live.get(id);
    if (!session) throw new RuntimeError("not-found");
    if (session.loading) {
      await deadline(session.loading, this.timeout).catch((error: unknown) => {
        if (this.live.has(id)) throw error;
      });
      if (!this.live.has(id)) return;
    }
    await session.stop();
  }
  /**
   * Puts a session away: it unloads and leaves the list. Refused while it runs, waits for an answer
   * or has a prompt waiting for its turn.
   */
  async archive(id: string): Promise<void> {
    validateId(id);
    // A parent takes its children along; nothing is put away while any of them works.
    const ids = [...this.children.of(id).filter((child) => !child.archived).map((child) => child.id), id];
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
  /** Between replies: another model or thinking level for this session, from its next reply on. */
  async configure(id: string, change: { model?: ModelChoice; thinking?: ThinkingLevel }): Promise<SessionDoc> {
    validateId(id);
    if (change.model !== undefined && !validChoice(change.model)) throw new RuntimeError("invalid-input");
    if (change.thinking !== undefined && !THINKING.includes(change.thinking)) throw new RuntimeError("invalid-input");
    if (!change.model && !change.thinking) throw new RuntimeError("invalid-input");
    await this.ensure(id);
    const session = this.live.get(id);
    if (!session) throw new RuntimeError("not-found");
    await session.configure(change);
    return session.doc();
  }
  /** Snapshot history through Pi. A fork has navigation ancestry but no parent result routing. */
  async fork(sourceId: string): Promise<string> {
    validateId(sourceId);
    this.admit();
    const source = this.storage.read(sourceId);
    const session = this.live.get(sourceId);
    if (source.archived || source.queued !== undefined || (session && !session.settled)) throw new RuntimeError("busy");
    const transcript = this.storage.validateHistory(source);
    if (!transcript) throw new RuntimeError("not-found");
    const id = randomUUID();
    const destination = this.storage.prepare(id);
    try {
      const fork = SessionManager.forkFrom(transcript, source.cwd, destination, { id });
      const movedUploads = new Map<string, string>();
      const files = this.files(sourceId);
      if (files.length) mkdirSync(filesFolder(destination), { mode: 0o700 });
      for (const file of files) {
        const from = this.attachment(sourceId, file.name);
        const to = join(filesFolder(destination), file.name);
        await copyFile(from, to, constants.COPYFILE_FICLONE);
        if (file.by === "you") {
          movedUploads.set(from, to);
          const markers = join(destination, "uploads");
          mkdirSync(markers, { recursive: true, mode: 0o700 });
          writeFileSync(join(markers, file.name), "", { mode: 0o600 });
        }
      }
      if (movedUploads.size) {
        const entries = [fork.getHeader(), ...fork.getEntries().map((entry) => forkAttachmentTags(entry, movedUploads))];
        writeFileSync(fork.getSessionFile()!, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", { mode: 0o600 });
      }
      this.admit();
      const createdAt = new Date().toISOString();
      this.storage.write({
        version: 2, id, cwd: source.cwd, agent: source.agent, model: source.model,
        thinking: source.thinking, title: sessionTitle(`Fork of ${source.title ?? "conversation"}`),
        createdAt, seenAt: createdAt, active: false, interrupted: false,
        tracksUploads: true, forkOf: sourceId,
      });
      return id;
    } catch (error) {
      this.storage.remove(id);
      throw runtimeError(error, "storage");
    }
  }
  async compact(id: string): Promise<void> {
    validateId(id);
    await this.ensure(id);
    await this.get(id).compact();
  }
  /** A person looked at a session (on any device): it's read. */
  seen(id: string): void {
    validateId(id);
    const at = new Date().toISOString();
    const live = this.live.get(id);
    if (live) return live.seen(at);
    this.storage.write({ ...this.storage.read(id), seenAt: at });
  }
  /** A person names a session, loaded or not; the agent's title tool no longer changes it. */
  rename(id: string, input: string): void {
    validateId(id);
    const title = sessionTitle(input);
    if (!title) throw new RuntimeError("invalid-input");
    const live = this.live.get(id);
    if (live) return live.rename(title);
    this.storage.write({ ...this.storage.read(id), title, renamed: true });
  }
  restore(id: string): void {
    validateId(id);
    for (const each of [id, ...this.children.of(id).map((child) => child.id)]) {
      const { archived, ...metadata } = this.storage.read(each);
      if (archived) this.storage.write(metadata);
    }
  }
  /**
   * Deletes an archived session for good, with everything in its folder. Its working folder, and
   * an app's own folder, are not its to remove.
   */
  delete(id: string): void {
    validateId(id);
    const metadata = this.storage.read(id);
    const children = this.children.of(id);
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
   * The tools an agent (or a session's own layer) provides, found by loading its extensions without a
   * session. Nothing when the agent cannot be resolved; its view says why.
   */
  async discoverTools(target: AgentTarget) {
    let setup: Setup;
    try {
      setup = resolveSetup(this.agents, target);
    } catch {
      return undefined;
    }
    return this.tools.tools(setup);
  }


  // ---- Processes ------------------------------------------------------------------------------

  /** A session's processes, for clients. */
  listProcesses(sessionId: string): ProcessInfo[] {
    return this.sessionProcesses.list(sessionId);
  }
  /** Every process still running, with its session's title. */
  runningProcesses(): ProcessList {
    return this.sessionProcesses.running();
  }
  processOutput(sessionId: string, id: string, since: number): ProcessOutput {
    return this.sessionProcesses.output(sessionId, id, since);
  }
  /** The person stops a process; its session is told. */
  stopProcess(sessionId: string, id: string): void {
    this.sessionProcesses.stop(sessionId, id);
  }
  /** The data folder this runtime reads and writes. */
  get dataFolder(): string {
    return homePaths(this.configuration.home).root;
  }
  /** What a restart would interrupt now: replies in progress and background processes. */
  runningWork(): RunningWork {
    const replies = this.list()
      .filter((s) => ["running", "queued", "stopping"].includes(s.status) || s.waiting || s.queued)
      .map((s) => ({ session: s.id, title: s.title ?? "New session" }));
    const processes = this.runningProcesses().processes.map((p) => ({ session: p.sessionId, title: p.session.title ?? "New session", name: p.title || p.command }));
    return { replies, processes };
  }

  // ---- Hold -----------------------------------------------------------------------------------

  /** The person answers a hold request: allowing it switches `hold:<extension>` on in the agent. */
  answerHold(id: string, allow: unknown): void {
    this.holds.answer(id, allow);
  }
  /** The person lets go of a hold: the session unloads when idle. The agent still allows it. */
  releaseHold(id: string): void {
    this.holds.release(id);
  }

  // ---- Routines -------------------------------------------------------------------------------

  listRoutines(): RoutineList {
    return { paused: this.unattendedPaused, routines: this.routines.list() };
  }
  /** Switches a routine on or off: an ordinary switch (`routine:<id>`) in the agent's own definition. */
  setRoutine(agent: string, id: string, on: unknown): Routine {
    if (!validAgentId(agent) || typeof id !== "string" || typeof on !== "boolean") throw new RuntimeError("invalid-input");
    if (!this.runs.routineAgents().find((p) => p.id === agent)?.routines.some((r) => r.id === id)) throw new RuntimeError("not-found");
    this.agents.setSwitch(agent, switchName("routine", id), on);
    if (on) this.routines.switchedOn(agent, id);
    return this.routines.list().find((r) => r.agent.id === agent && r.id === id)!;
  }
  /** Run now, with the person watching. */
  runRoutine(agent: string, id: string): Promise<void> {
    if (!this.accepting) throw new RuntimeError("closed");
    if (!validAgentId(agent) || typeof id !== "string") throw new RuntimeError("invalid-input");
    return this.routines.runNow(agent, id);
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
        const { title, agent } = this.summary(metadata, this.live.get(metadata.id));
        return [{ ...schedule, session: { ...(title ? { title } : {}), agent } }];
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
      await this.holds.keep();
      await this.wakes.drain();
    })().finally(() => (this.checking = undefined)));
  }
  async shutdown(): Promise<void> {
    this.accepting = false;
    clearInterval(this.sweeper);
    if (this.ticker) clearInterval(this.ticker);
    this.unwatchAgents();
    this.schedules.shutdown();
    const results = await Promise.allSettled([
      this.checking?.catch(() => {}).then(() => this.wakes.shutdown()) ?? this.wakes.shutdown(),
      this.agents.shutdown(),
      this.processes.shutdown(),
      ...[...this.live.keys()].map((id) => this.stop(id)),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw runtimeError(failed.reason, "execution");
  }

  // ---- One session, by id ------------------------------------------------------------------------

  /** Everything about a session except its history: status, model, queue and what extensions show. */
  session(id: string): SessionDoc {
    return this.get(id).doc();
  }
  /** The live document: session state, the items in flight and what running tools reported. */
  liveDoc(id: string): LiveDoc {
    return this.get(id).liveDoc();
  }
  /** Finalized items on the session's active branch, read straight from Pi's session. */
  items(id: string, options: { before?: string; after?: string; limit?: number }): ItemsPage {
    return this.get(id).page(options);
  }
  image(id: string, itemId: string, part: number) {
    return this.get(id).image(itemId, part);
  }
  text(id: string, itemId: string, part: number, offset: number): PartPage {
    return this.get(id).text(itemId, part, offset);
  }
  /** A connection's live view of the session, and the invalidations that say when to ask it for more. */
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
  start(id: string, text: string, attachments: readonly string[] = []): RunHandle {
    validateText(text);
    if (!this.accepting) throw new RuntimeError("closed");
    return this.get(id).start(this.withAttachments(id, text, attachments));
  }
  /** Steer or follow up a running session. */
  async queue(id: string, text: string, kind: "steer" | "follow-up", attachments: readonly string[] = []): Promise<"queued" | "handled"> {
    validateText(text);
    if (kind !== "steer" && kind !== "follow-up") throw new RuntimeError("invalid-input");
    return this.get(id).queue(this.withAttachments(id, text, attachments), kind);
  }

  // ---- Attachments ----------------------------------------------------------------------------

  /** Stores a file a person attaches to a message in the session's `files/` folder; returns its stored name. */
  async attach(id: string, name: string, body: Readable): Promise<{ name: string; size: number }> {
    validateId(id);
    const metadata = this.storage.read(id);
    if (metadata.archived) throw new RuntimeError("busy");
    return saveAttachment(this.storage.directory(id), name, body);
  }
  /** The path of an attachment of this session, to be served as inert data. */
  /** The session's files folder: what the person attached and what the agent made there, newest first. */
  files(id: string): SessionFile[] {
    validateId(id);
    const metadata = this.storage.read(id);
    const directory = this.storage.directory(id);
    const folder = filesFolder(directory);
    const uploads = uploadedNames(directory);
    let sent: Set<string> | undefined;
    if (uploads.size || !metadata.tracksUploads) {
      const session = this.live.get(id);
      if (session?.ready && !session.readOnly) sent = session.sentFiles();
      else {
        // A damaged transcript cannot establish which uploads were sent. Still list agent files.
        try {
          const transcript = this.storage.validateHistory(metadata);
          if (transcript) sent = sentAttachmentNames(directory, SessionManager.open(transcript, directory).getEntries());
        } catch {
          // Leave the uploads hidden until a valid transcript can confirm them.
        }
      }
    }
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      return [];
    }
    return names
      .filter((name) => validAttachmentName(name) && (!uploads.has(name) || sent?.has(name)))
      .flatMap((name) => {
        try {
          const stats = statSync(join(folder, name));
          if (!stats.isFile()) return [];
          return [{ name, size: stats.size, modified: stats.mtime.toISOString(), by: sent?.has(name) ? "you" as const : metadata.tracksUploads ? "agent" as const : undefined }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .slice(0, 200);
  }
  attachment(id: string, name: string): string {
    validateId(id);
    this.storage.read(id);
    const path = attachmentPath(this.storage.directory(id), name);
    if (!path) throw new RuntimeError("not-found");
    return path;
  }
  private withAttachments(id: string, text: string, attachments: readonly string[]): string {
    if (!attachments.length) return text;
    const placed = placeAttachments(this.storage.directory(id), text, attachments);
    validateText(placed);
    return placed;
  }
  cancel(id: string): Promise<void> {
    return this.get(id).cancel();
  }
}

export type { RuntimeConfiguration } from "./configuration.js";
export type { RunHandle, RunResult, SessionStatus, SessionSummary } from "./session.js";
export { RuntimeError } from "./errors.js";
export type { SessionChange } from "./observation.js";
