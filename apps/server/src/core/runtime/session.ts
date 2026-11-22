import { AsyncLocalStorage } from "node:async_hooks";
import { basename, dirname, join } from "node:path";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, EventBus, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Provider } from "@earendil-works/pi-ai";
import { HOLD_CHANNEL, NOTICE_ENTRY, type HoldRequest, type ReadOnlyReason, type ItemsPage, type LiveDoc, type PartPage, type PendingSetup, type SessionCommand, type SessionDoc } from "../../contract/protocol.js";
import { ExtensionUI } from "../extensions/extension-ui.js";
import { ExtensionRendering } from "../extensions/extension-render.js";
import { ExtensionViews } from "../extensions/views.js";
import type { Json } from "../../contract/stream-ops.js";
import type { SafeLogger } from "../logger.js";
import type { Setup } from "../agents/resolve.js";
import type { SessionAgent, ThinkingLevel } from "../../contract/agent-protocol.js";
import type { ModelChoice } from "../../contract/provider-protocol.js";
import { sessionTitle } from "../../contract/session-title.js";
import { toolSessionTitle } from "./session-title.js";
import { attachedImages, sentAttachmentNames, namingFiles } from "./attachments.js";
import { validItemName } from "../agents/format.js";
import { PROCESS_CHANNEL, validProcessMessage, type ProcessRequest } from "./process-tool.js";
import { ExtensionRevisions, extensionNameValid, type ExtensionChange } from "./extension-revisions.js";
import type { SetupChange } from "./setup-changes.js";
import { EXTENSION_CHANNEL, EXTENSION_TOOL, type ExtensionMessage } from "./extension-tool.js";
import { createSessionServices, resolveFolder } from "./configuration.js";
import { providerUsageLimited, deadline, replyFailure, RuntimeError, runtimeError, unsupported } from "./errors.js";
import type { RuntimeErrorCode } from "./errors.js";
import { ItemProjector, progressOf } from "./items.js";
import { LiveView } from "./live-view.js";
import { SessionChanges } from "./observation.js";
import type { SessionChange } from "./observation.js";
import type { ProviderSettings } from "./provider-settings.js";
import type { RunSlots } from "./run-slots.js";
import type { SessionMetadata, SessionStorage } from "./storage.js";
import { STATUS_ENTRY, WOKEN_ENTRY, type StatusDetails, type WokenDetails } from "../../contract/wake-protocol.js";
import type { Schedule, ScheduleInput } from "../../contract/schedule-protocol.js";
import { describeSchedule, parseCron } from "../../contract/cron.js";
import { SCHEDULE_CHANNEL, validMessage, type ScheduleMessage } from "./schedule-tool.js";
import {
  CHILD_ENDED_CHANNEL,
  REPORT_TOOL,
  RESULT_CHANNEL,
  SESSION_CHANNEL,
  validResultData,
  validSessionMessage,
  type ChildEnded,
  type SessionRequest,
} from "./session-tool.js";

export type SessionStatus =
  | "starting"
  | "idle"
  /** A prompt waits for a free run slot. */
  | "queued"
  | "running"
  | "cancelling"
  | "stopping"
  | "error"
  | "stopped"
  /** Open for reading only: its model, agent or folder can't be used (`readOnly` says which). */
  | "read-only";
export interface SessionSummary {
  id: string;
  /** Working folder on this host. */
  folder: string;
  createdAt: string;
  /** When it last did something (see `SessionInfo.lastActivity`). */
  lastActivity: string;
  title?: string;
  hasHistory?: boolean;
  status: SessionStatus | "unloaded";
  interrupted: boolean;
  agent: SessionAgent;
  /** The agent changed since this session started; reload to apply. */
  agentChanged?: boolean;
  /** An extension asked a question and the run waits for an answer. */
  waiting?: boolean;
  question?: string;
  workingSince?: string;
  unread?: boolean;
  /** Waits for a free run slot: a prompt that has not started, or a run resuming after an answer. */
  queued?: boolean;
  /** The session that started this one. */
  parent?: string;
  /** The schedule or app routine this session is one run of. */
  schedule?: { id: string; due: string };
  /** Kept loaded while no one watches, by one of its extensions. */
  held?: { extension: string; reason: string };
  /** How many processes it started are running. */
  processes?: number;
  /** Open for reading only, and why. */
  readOnly?: ReadOnlyReason;
}
export interface RunResult {
  outcome: "completed" | "cancelled" | "failed";
  error?: RuntimeErrorCode;
  /** Set only for child runs using notice delivery. */
  childResult?: ChildRunResult & { id: string; answer?: string };
}

const CHILD_RESULT_ENTRY = "pispark:child-result";
interface ChildRunResult {
  outcome: RunResult["outcome"];
  error?: RuntimeErrorCode;
  answerId?: string;
  data?: unknown;
}

function answerOf(entry: SessionEntry | undefined): string | undefined {
  if (entry?.type !== "message" || entry.message.role !== "assistant") return undefined;
  if (entry.message.stopReason !== "stop" && entry.message.stopReason !== "length") return undefined;
  return entry.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim() || undefined;
}
export interface RunHandle {
  completion: Promise<RunResult>;
}
type ModelSelection = Awaited<ReturnType<ProviderSettings["select"]>>;

/** What a session needs from the runtime that holds it. */
export interface SessionHost {
  readonly storage: SessionStorage;
  readonly slots: RunSlots;
  readonly logger: SafeLogger;
  readonly timeout: number;
  readonly callTimeout?: number;
  /** The contribution points the client draws, besides the items of a session's history. */
  readonly points?: readonly string[];
  /** Whether the runtime still takes new work. */
  accepting(): boolean;
  /** Whether this session is the one the runtime holds for its id. */
  holds(session: Session): boolean;
  /** The session's agent, resolved now. */
  setup(metadata: SessionMetadata): Setup;
  /** The model the session runs: a provider's (chosen as Ask, agent and defaults say) or the tests' fixed one. */
  model(metadata: SessionMetadata, setup: Setup): Promise<{ managed?: ModelSelection; fixed?: { provider: Provider; id: string } }>;
  /** The session as the list shows it. */
  summary(session: Session): SessionSummary;
  /** The session has stopped and is no longer held. */
  released(session: Session): void;
  /** The session became free (`settled`), so a waiting wake can go. Called outside Pi's listeners. */
  freed?(session: Session): void;
  /** Something about the session changed (cheap; the workspace stream coalesces it). */
  touched?(): void;
  /** The processes a session starts and follows, for its agent (`pispark_process`). */
  readonly processes?: {
    request(sessionId: string, request: ProcessRequest, signal?: AbortSignal): Promise<{ ok: boolean; text: string }>;
  };
  /** The tools a running session of a setup has (`fingerprint`), from Pi's `getAllTools`. */
  toolsSeen?(fingerprint: string, extensionPaths: string[], tools: { name: string; description?: string; sourceInfo?: { path?: string } }[]): void;
  /** An extension asks to keep the session loaded (or lets go). */
  hold?(session: Session, request: { extension: string; hold: boolean; reason: string }): { state: "held" | "asked" | "released" | "refused"; text: string };
  /** One of the session's runs ended (a child reports back). Called outside Pi's listeners. */
  ended?(session: Session, result: RunResult): void;
  /**
   * A change to what the session runs, asked for from inside it (its agent or an extension), or an
   * extension revision to activate: applied once the session is free. False when refused.
   */
  requestSetup?(session: Session, change: SetupChange): boolean;
  /** What waits to change once the session is free. */
  pendingSetup?(id: string): PendingSetup | undefined;
  /** The staged extension revision a reload will activate, or is activating. */
  extensionPending?(id: string): string | undefined;
  extensionCandidate?(id: string): ExtensionChange[] | undefined;
  /** The sessions a session starts and follows, for its agent (`pispark_session`). */
  readonly sessions?: {
    request(parentId: string, request: SessionRequest): Promise<{ ok: boolean; text: string }>;
  };
  /** The schedules of a session, for its agent (`pispark_schedule`). */
  readonly schedules?: {
    of(sessionId: string): Schedule[];
    add(sessionId: string, input: ScheduleInput, by: "agent"): Schedule;
    remove(id: string): void;
  };
}

/** One run's identity: whether it was cancelled, settled, and whether it may still take input. */
interface Run {
  providerError?: "execution" | "usage-limit";
  cancelled: boolean;
  settled: boolean;
  /** Settling: no new steer or follow-up may join this run. */
  admissionClosed?: boolean;
}

/** Steer and follow-up input being prepared knows which run it belongs to. */
const inputAdmission = new AsyncLocalStorage<{ valid: () => boolean }>();

/** The commands extensions registered with Pi, by the name that runs each: a client lists them as actions. */
function commandsOf(session: AgentSession): SessionCommand[] {
  return session.extensionRunner
    .getRegisteredCommands()
    .slice(0, 50)
    .map(({ invocationName: name, description }) => {
      const text = description?.replace(/\s+/g, " ").trim().slice(0, 200);
      return text ? { name, description: text } : { name };
    });
}

/** The agent's prompt templates, run as `/name`: what the reply box offers as you type `/`. */
function promptsOf(session: AgentSession): SessionCommand[] {
  return session.promptTemplates.slice(0, 100).map(({ name, description }) => {
    const text = description?.replace(/\s+/g, " ").trim().slice(0, 200);
    return text ? { name, description: text } : { name };
  });
}

/** What waits to change, for the session's document; nothing when nothing waits. */
const pendingOf = (pending: PendingSetup | undefined) => (pending && Object.keys(pending).length ? { pending } : {});

/** "extensions/notes.ts" and "extensions/notes/index.ts" are both "notes". */
export function extensionName(path: string): string {
  const name = basename(path).replace(/\.[^.]+$/, "");
  return name === "index" ? basename(dirname(path)) : name;
}
export function validateText(text: string): void {
  if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text, "utf8") > 64 * 1024)
    throw new RuntimeError("invalid-input");
}

/**
 * One session while it is loaded: its Pi session, what its extensions show, and its lifecycle.
 *
 *   starting → idle ⇄ (queued →) running → cancelling → idle | error
 *   any → stopping → stopped (released)
 *
 * A run holds one of the runtime's run slots while its agent works, gives it up while an extension
 * waits for a person, and needs one again to go on.
 */
export class Session {
  status: SessionStatus = "starting";
  metadata: SessionMetadata;
  error?: RuntimeErrorCode;
  /** Opened from history (or already published), as opposed to being created now. */
  published: boolean;
  /** When the session was last used: shown, sent to, answered, called. Idle sessions unload after a while. */
  lastUsed = Date.now();
  setupChanged = false;
  loading?: Promise<SessionDoc>;
  stopping?: Promise<void>;
  readonly observers = new Set<SessionChanges>();

  /** Open for reading only (from its transcript, without Pi's agent session), and why. */
  readOnly?: ReadOnlyReason;
  private pi?: AgentSession;
  private ui?: ExtensionUI;
  private runStartedAt?: number;
  private views?: ExtensionViews;
  private items?: ItemProjector;
  private sequence = 0;
  private closed = false;
  private extensionErrors = 0;
  private unsubscribe?: () => void;
  /** The current (or last) run and its completion. */
  private run?: Run;
  private runDone?: Promise<RunResult>;
  /** Ends a run Pi started by itself (see `adopt`). */
  private settleAdopted?: () => void;
  /** Whether the session was settled at the last change, to tell the host when it becomes free. */
  private wasSettled = true;
  /** A change of configuration, steer or follow-up being prepared. */
  private input?: Promise<unknown>;
  // configure() saves its model and thinking choice together after Pi has applied both.
  private configuringModel = false;
  private compacting = false;
  /** Pi is retrying a failed reply (`SessionDoc.retrying`). */
  private retrying?: SessionDoc["retrying"];
  private cancelling?: Promise<void>;
  /** Running tool calls and what they reported last (Pi's partial result), by call id. References only. */
  private readonly running = new Map<string, unknown>();
  /** A queued prompt's completion, resolved once it ran or was cancelled. */
  private queuedRun?: (result: Promise<RunResult> | RunResult) => void;
  /** The queued prompt was waiting when PiSpark stopped. */
  private restored = false;
  /** The run gave its slot up while an extension waits for a person. */
  private paused = false;
  /** Answered, the run waits for a slot to go on; called to go on. */
  private resuming?: () => void;
  /** The session's event bus, where its extensions listen. */
  private bus?: EventBus;
  /** Data an extension set for this session's result (`RESULT_CHANNEL`). */
  resultData?: unknown;
  /** An extension asked to keep this session loaded; the agent does not allow it yet. */
  holdAsked?: { extension: string; reason: string };

  constructor(
    private readonly host: SessionHost,
    metadata: SessionMetadata,
    reopening: boolean,
    /** Opened again by a reload: extensions are told `session_start` with reason `reload`, as Pi's own reload does. */
    private readonly reloading = false,
  ) {
    this.metadata = metadata;
    this.published = reopening;
  }

  get id(): string {
    return this.metadata.id;
  }
  /** Loaded and ready for clients. */
  get ready(): boolean {
    return !!this.items;
  }
  /** Pi has written the session's transcript; once it has, it always has. */
  get hasHistory(): boolean {
    return (this.historySeen ||= this.host.storage.hasHistory(this.id));
  }
  private historySeen = false;
  get asking(): boolean {
    return !!this.ui?.asking;
  }
  /** The waiting question's title, while one is open. */
  get question(): string | undefined {
    return this.ui?.question;
  }
  /** When the current run started, while it runs. */
  get workingSince(): number | undefined {
    return this.status === "running" || this.status === "cancelling" ? this.runStartedAt : undefined;
  }
  get waitingForSlot(): boolean {
    return this.status === "queued" || this.host.slots.queued(this.id);
  }
  touch(): void {
    this.lastUsed = Date.now();
  }
  /** Something visible changed; observers pull the new state. */
  changed(): void {
    this.sequence++;
    // No client callbacks, serialization, I/O or transcript copying in synchronous SDK listeners.
    for (const observer of this.observers) observer.push({ sessionId: this.id, sequence: this.sequence, type: "changed" });
    this.host.touched?.();
    const settled = this.settled;
    if (settled && !this.wasSettled) setImmediate(() => this.host.freed?.(this));
    this.wasSettled = settled;
  }
  /** Nothing runs, waits or is queued in the session, and no question is open. */
  get settled(): boolean {
    return (
      (this.status === "idle" || this.status === "error" || this.status === "read-only") &&
      !this.loading &&
      !this.input &&
      !this.queuedRun &&
      !this.asking &&
      !this.host.slots.holds(this.id) &&
      !this.host.slots.queued(this.id)
    );
  }
  /** Whether the session can be unloaded without anyone noticing: settled, and nobody has it on screen. */
  get unloadable(): boolean {
    return this.settled && this.observers.size === 0;
  }
  /** After an agent edit: whether the resolved setup still matches the one the session started with. */
  checkSetup(fingerprint: string): void {
    if (!this.pi || this.status === "stopping") return;
    const changed = fingerprint !== this.metadata.setup;
    if (changed !== this.setupChanged) {
      this.setupChanged = changed;
      this.changed();
    }
  }

  // ---- What clients read ----------------------------------------------------------------------

  private loaded(): { session: AgentSession; items: ItemProjector } {
    if (this.readOnly) throw new RuntimeError("read-only");
    if (!this.pi || !this.items) throw new RuntimeError("not-found");
    return { session: this.pi, items: this.items };
  }
  /** The session's history, also when it is read-only. */
  private history(): ItemProjector {
    if (!this.items) throw new RuntimeError("not-found");
    return this.items;
  }
  /** Everything about the session except its history: status, model, queue and what extensions show. */
  doc(): SessionDoc {
    if (this.readOnly)
      return {
        ...this.host.summary(this),
        ...(this.metadata.model ? { model: { ...this.metadata.model } } : {}),
        queue: { steering: 0, followUp: 0 },
        extensions: { dialogs: [], statuses: [], widgets: [], notices: [], views: [] },
        commands: [],
      };
    const { session } = this.loaded();
    return {
      ...this.host.summary(this),
      model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined,
      thinking: { level: session.thinkingLevel as ThinkingLevel, levels: session.getAvailableThinkingLevels() as ThinkingLevel[] },
      ...contextOf(session),
      ...(this.compacting ? { compacting: true } : {}),
      ...(this.retrying ? { retrying: { ...this.retrying } } : {}),
      queue: { steering: session.getSteeringMessages().length, followUp: session.getFollowUpMessages().length },
      ...(this.status === "queued" && this.metadata.queued !== undefined ? { queuedText: this.metadata.queued } : {}),
      ...(this.status === "queued" && this.restored ? { restored: true as const } : {}),
      error: this.error,
      extensions: {
        ...(this.ui?.view() ?? { dialogs: [], statuses: [], widgets: [], notices: [] }),
        views: this.views?.view() ?? [],
      },
      commands: commandsOf(session),
      prompts: promptsOf(session),
      ...(this.holdAsked ? { holdAsked: { ...this.holdAsked } } : {}),
      ...pendingOf(this.host.pendingSetup?.(this.id)),
    };
  }
  /** The live document: session state, the items in flight and what running tools reported. */
  liveDoc(): LiveDoc {
    return { session: this.doc(), tail: this.history().tail(), progress: progressOf(this.running) };
  }
  /** Finalized items on the session's active branch, read straight from Pi's session. */
  page(options: { before?: string; after?: string; limit?: number }): ItemsPage {
    return this.history().page(options);
  }
  image(itemId: string, part: number) {
    return this.history().image(itemId, part);
  }
  text(itemId: string, part: number, offset: number): PartPage {
    return this.history().text(itemId, part, offset);
  }
  /** A connection's live view of the session, and the invalidations that say when to ask it for more. */
  observe(): { view: LiveView; events: AsyncIterableIterator<SessionChange> & { close(): void } } {
    const items = this.history();
    if (this.observers.size >= 16) throw new RuntimeError("limit");
    this.touch();
    const events = new SessionChanges(() => {
      this.observers.delete(events);
      this.touch();
    });
    this.observers.add(events);
    try {
      const view = new LiveView(this.id, { doc: () => this.liveDoc(), head: () => items.head(), since: (after) => items.since(after) });
      return { view, events };
    } catch (error) {
      events.close();
      throw error;
    }
  }
  /** An extension component's `host.call`: a function of its own placement, and its result. */
  call(point: string, key: string, name: string, data?: Json): Promise<Json | undefined> {
    this.loaded();
    this.touch();
    if (!this.views) throw new RuntimeError("not-found");
    return this.views.call(point, key, name, data);
  }
  /** An extension component's `host.file`: a file in the folder its own placement named. */
  file(point: string, key: string, path: string): string {
    this.loaded();
    this.touch();
    if (!this.views) throw new RuntimeError("not-found");
    return this.views.file(point, key, path);
  }
  /** Answer a question an extension asked through Pi's `ctx.ui`. */
  answer(dialogId: string, answer: string | boolean | null): void {
    this.loaded();
    this.touch();
    if (!this.ui) throw new RuntimeError("not-found");
    this.ui.answer(dialogId, answer);
  }

  // ---- Loading --------------------------------------------------------------------------------

  /** Starts Pi's session for the session, bounded by the operation timeout; setup keeps ownership until it really ends. */
  async load(): Promise<SessionDoc> {
    const operation = this.initialize().catch(async (error: unknown) => {
      this.error = runtimeError(error, "configuration").code;
      this.host.logger.event("session.failure", { sessionId: this.id, outcome: "failed", code: this.error });
      await this.dispose();
      throw runtimeError(error, "configuration");
    });
    this.loading = operation;
    void operation.finally(() => (this.loading = undefined)).catch(() => {});
    try {
      return await deadline(operation, this.host.timeout);
    } catch (error) {
      if (error instanceof RuntimeError && error.code === "timeout") {
        this.error = "timeout";
        this.closed = true;
        this.status = "stopping";
        // Setup may still own extension work. Keep admission until it actually finishes.
        void operation.then(() => this.dispose(), () => {}).catch(() => {});
      }
      throw runtimeError(error, "configuration");
    }
  }

  private async initialize(): Promise<SessionDoc> {
    const { metadata, host } = this;
    const reopening = this.published;
    // What the session needs to run. When one of them can't be had, a session with a past opens to be read.
    let step: ReadOnlyReason = "folder";
    let cwd: string, setup: Setup, model: Awaited<ReturnType<SessionHost["model"]>>;
    try {
      cwd = await resolveFolder(metadata.cwd);
      step = "agent";
      try {
        setup = host.setup(metadata);
      } catch {
        throw new RuntimeError("agent");
      }
      step = "model";
      model = await host.model(metadata, setup);
    } catch (error) {
      if (reopening && host.accepting()) return this.openReadOnly(step);
      throw error;
    }
    const { managed, fixed } = model;
    metadata.model = managed ? managed.choice : { provider: fixed!.provider.id, id: fixed!.id };
    metadata.cwd = cwd;
    const dir = host.storage.prepare(metadata.id);
    const transcript = reopening ? host.storage.validateHistory(metadata) : undefined;
    metadata.interrupted ||= metadata.active;
    // A child session names its parent in Pi's own header too, so Pi's tools see the relation.
    const parentSession = metadata.parent ? host.storage.transcript(metadata.parent) : undefined;
    const manager = transcript
      ? SessionManager.open(transcript, dir, cwd)
      : SessionManager.create(cwd, dir, { id: metadata.id, ...(parentSession ? { parentSession } : {}) });
    metadata.active = true;
    metadata.setup = setup.fingerprint;
    if (reopening) host.storage.write(metadata);
    // Before extensions load: they may place components and raise notices while loading.
    const ui = (this.ui = new ExtensionUI({
      changed: () => this.changed(),
      position: () => this.pi?.messages.length ?? 0,
      cwd,
      paused: () => this.pause(),
      resume: (go) => this.resume(go),
      save: (notice) => {
        if (!this.published || !this.pi || this.closed) return false;
        this.pi.sessionManager.appendCustomEntry(NOTICE_ENTRY, notice);
        this.host.storage.active(this.id);
        this.changed();
        return true;
      },
    }));
    const revisions = this.extensionRevisions;
    const candidates = host.extensionCandidate?.(this.id);
    const active = candidates ?? revisions.read().active;
    const activating = candidates?.find((change) => change.revision === host.extensionPending?.(this.id));
    for (const change of active) revisions.verify(change);
    const extensionPaths = [...setup.extensionPaths, ...active.map((change) => revisions.loadPath(change))];
    const development = !setup.toolsOff.includes(EXTENSION_TOOL);
    const views = (this.views = new ExtensionViews(
      extensionPaths.map((path) => dirname(path)),
      {
        changed: () => this.changed(), failed: (message) => ui.failed(message),
        callTimeoutMs: host.callTimeout, points: host.points,
        ...(activating ? { activationFolder: dirname(revisions.loadPath(activating)) } : {}),
      },
    ));
    const services = await createSessionServices({
      // A session started by another session cannot start sessions: one level only. Only one in
      // status mode raises things with its parent.
      setup: {
        ...setup,
        extensionPaths,
        toolsOff: [
          ...setup.toolsOff,
          ...(metadata.parent && metadata.report === "status" ? [] : [REPORT_TOOL]),
        ],
      },
      cwd,
      agentDir: join(dir, "pi"),
      managed,
      fixed,
      admission: {
        valid: () => inputAdmission.getStore()?.valid() ?? true,
        beforeRun: () => this.adopt(),
        beforeProviderDispatch: () => {
          // Pi still calls the provider once after a cancel that arrived while it prepared the run.
          if (this.run?.cancelled || this.status === "stopping") {
            // Native ModelRuntime.lazyStream converts setup exceptions to a settled event stream.
            throw new DOMException("The operation was aborted.", "AbortError");
          }
        },
        beforeSettle: async () => {
          const run = this.run;
          if (!run) return;
          // Close new admission across settlement; only input this run already admitted may finish.
          run.admissionClosed = true;
          await this.input?.catch(() => {});
        },
      },
      host: {
        modelSelected: () => {
          const model = this.pi?.model;
          if (!model || this.configuringModel) return;
          const choice = { provider: model.provider, id: model.id };
          if (this.metadata.model?.provider === choice.provider && this.metadata.model.id === choice.id) return;
          // Keep the attached model used by reopen and child creation in step with Pi's live selection.
          if (this.published) host.storage.write({ ...this.metadata, model: choice });
          this.metadata.model = choice;
          this.changed();
        },
        views,
        schedules: { bind: (bus) => bus.on(SCHEDULE_CHANNEL, (message) => this.scheduleRequest(message)) },
        sessions: {
          bind: (bus) => {
            this.bus = bus;
            const off = [
              bus.on(SESSION_CHANNEL, (message) => this.sessionRequest(message)),
              ...(development ? [bus.on(EXTENSION_CHANNEL, (message) => void this.extensionRequest(message))] : []),
              bus.on(HOLD_CHANNEL, (message) => this.holdRequest(message)),
              bus.on(PROCESS_CHANNEL, (message) => this.processRequest(message)),
              bus.on(RESULT_CHANNEL, (message) => {
                const data = (message as { data?: unknown } | undefined)?.data;
                if (validResultData(data)) this.resultData = structuredClone(data);
              }),
            ];
            return () => off.forEach((each) => each());
          },
        },
      },
    });
    // The level chosen for this session wins over its agent's.
    const thinkingLevel = metadata.thinking ?? setup.settings.thinking ?? "off";
    let session: AgentSession;
    try {
      ({ session } = await createAgentSession({
        cwd,
        agentDir: join(dir, "pi"),
        model: services.model,
        modelRuntime: services.modelRuntime,
        settingsManager: services.settingsManager,
        resourceLoader: services.resourceLoader,
        sessionManager: manager,
        // An empty list would be an allowlist of nothing; the settings' default tools are then [].
        tools: services.toolSwitches.length ? services.toolSwitches : undefined,
        excludeTools: services.excludedTools,
        thinkingLevel,
        scopedModels: [{ model: services.model, thinkingLevel }],
        sessionStartEvent: { type: "session_start", reason: this.reloading ? "reload" : reopening ? "resume" : "new" },
      }));
    } catch (error) {
      services.resourceLoader.getExtensions().runtime.invalidate("Session creation failed");
      throw error;
    }
    this.pi = session;
    if (session.model?.provider !== metadata.model.provider || session.model?.id !== metadata.model.id)
      throw new RuntimeError("configuration");
    if (this.error) throw new RuntimeError(this.error);
    this.unsubscribe = session.subscribe((event) => this.onEvent(event));
    const rendering = new ExtensionRendering(session, () => this.changed());
    this.items = new ItemProjector(session, rendering, (customType) => views.has(`item.custom:${customType}`));
    // Pi's mode for clients that are not a terminal: dialogs and notices work, terminal components don't.
    await session.bindExtensions({
      mode: "rpc",
      uiContext: ui.context,
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: unsupported,
        fork: unsupported,
        navigateTree: unsupported,
        switchSession: unsupported,
        // Pi's own reload from an extension's command: the session's one reload, once the command is done.
        reload: async () => {
          if (this.closed || !this.host.requestSetup?.(this, { reload: true })) throw new Error("This session cannot reload now.");
        },
      },
      abortHandler: () => void this.cancel("extension-abort").catch(() => {}),
      shutdownHandler: () => setImmediate(() => void this.stop().catch(() => {})),
      onError: (failure) => {
        this.extensionErrors++;
        // Once the session is open, a failing handler is reported and the session keeps working, as in Pi.
        if (this.published) ui.extensionFailed(extensionName(failure.extensionPath), failure.event, failure.error);
        else this.error = "extension";
        this.changed();
      },
    });
    await views.finishActivation().catch(() => { throw new RuntimeError("extension"); });
    if (this.error) throw new RuntimeError(this.error);
    if (this.closed) throw new RuntimeError("timeout");
    this.extensionPaths = setup.extensionPaths;
    const resources = services.resourceLoader;
    this.resources = {
      skills: resources.getSkills().skills.map(({ name, filePath }) => ({ name, filePath })),
      prompts: resources.getPrompts().prompts.map(({ name }) => name),
      context: resources.getAgentsFiles().agentsFiles.map(({ path }) => path),
      extensions: resources.getExtensions().extensions.filter((extension) => !extension.path.startsWith("<inline:")).map((extension) => ({
        path: extension.path, tools: [...extension.tools.keys()], commands: [...extension.commands.keys()],
      })),
      instructionLayers: setup.instructions.length,
    };
    this.reportTools();
    metadata.active = false;
    this.setupChanged = false;
    this.status = "idle";
    this.changed();
    host.storage.write(metadata);
    this.published = true;
    host.logger.event(reopening ? "session.recover" : "session.create", { sessionId: metadata.id, agentId: metadata.agent, outcome: "completed" });
    // A prompt that was waiting when PiSpark stopped rejoins the queue now that the session is open.
    if (reopening && metadata.queued !== undefined) this.restoreQueued(metadata.queued);
    return this.doc();
  }

  /**
   * Opens the session for reading only: its history from Pi's transcript, with no agent session, no
   * extensions and no model. Nothing about the session is written; reloading tries the full open again.
   */
  private openReadOnly(reason: ReadOnlyReason): SessionDoc {
    const { metadata, host } = this;
    const transcript = host.storage.validateHistory(metadata);
    const manager = transcript
      ? SessionManager.open(transcript, host.storage.prepare(metadata.id), metadata.cwd)
      : SessionManager.inMemory(metadata.cwd);
    this.items = new ItemProjector({ sessionManager: manager, messages: [], state: {} });
    this.readOnly = reason;
    this.status = "read-only";
    this.changed();
    host.logger.event("session.recover", { sessionId: metadata.id, outcome: "rejected", code: reason === "model" ? "configuration" : reason });
    return this.doc();
  }

  /** An extension asks to keep this session loaded, or lets go (`HOLD_CHANNEL`). */
  private holdRequest(value: unknown): void {
    const message = value as HoldRequest | undefined;
    const reply = typeof message?.reply === "function" ? message.reply : () => {};
    if (
      !message ||
      typeof message !== "object" ||
      !validItemName(message.extension) ||
      typeof message.hold !== "boolean" ||
      (message.hold && (typeof message.reason !== "string" || !message.reason.trim() || message.reason.length > 200))
    )
      return reply({ state: "refused", text: "Give the extension's name, hold, and (to hold) a short reason." });
    const answer = this.host.hold?.(this, { extension: message.extension, hold: message.hold, reason: message.reason?.trim() ?? "" }) ?? {
      state: "refused" as const,
      text: "Holding is not available here.",
    };
    reply(answer);
  }
  /** The built-in process tool (or an extension in this session): its own processes and its children's. */
  private processRequest(value: unknown): void {
    if (!validProcessMessage(value)) return;
    value.taken = true;
    const processes = this.host.processes;
    void (processes ? processes.request(this.id, value.request, value.signal) : Promise.resolve({ ok: false, text: "Background processes are not available here." }))
      .catch((error: unknown) => ({ ok: false, text: `That did not work (${runtimeError(error, "execution").code}).` }))
      .then((answer) => value.reply(answer));
  }
  /** The built-in session tool (or an extension in this session): its own children only. */
  private sessionRequest(value: unknown): void {
    if (!validSessionMessage(value)) return;
    value.taken = true;
    if (value.request.action === "inspect") {
      try { value.reply({ ok: true, text: this.inspect() }); }
      catch { value.reply({ ok: false, text: "Cannot read this session's extension state." }); }
      return;
    }
    if (value.request.action === "reload") {
      const scheduled = !this.closed && this.published && !!this.host.requestSetup?.(this, { asked: "pispark_session (reload)" });
      value.reply(scheduled
        ? { ok: true, text: "The session reloads when this turn ends, picking up its agent's current setup, and you get the outcome as a new message. End your turn now rather than checking." }
        : { ok: false, text: "This session cannot reload now." });
      return;
    }
    if (this.metadata.parent && value.request.action !== "report") {
      value.reply({ ok: false, text: "Child sessions cannot manage other sessions." });
      return;
    }
    const sessions = this.host.sessions;
    void (sessions ? sessions.request(this.id, value.request) : Promise.resolve({ ok: false, text: "Starting sessions is not available here." }))
      .catch((error: unknown) => ({ ok: false, text: `That did not work (${runtimeError(error, "execution").code}).` }))
      .then((answer) => value.reply(answer));
  }
  /**
   * Tells this session's extensions that one of its children ended or raised something, before the
   * agent hears of it. Their synchronous reply decides (see `CHILD_ENDED_CHANNEL`).
   */
  offerChildEnded(event: Omit<ChildEnded, "reply">): { action: "skip" } | { action: "send"; text: string } | undefined {
    if (!this.bus) return undefined;
    let answer: { action: "skip" } | { action: "send"; text: string } | undefined;
    const reply: ChildEnded["reply"] = (value) => {
      if (answer || !value || typeof value !== "object") return;
      if (value.action === "skip") answer = { action: "skip" };
      else if (value.action === "send" && typeof value.text === "string" && value.text.trim() && Buffer.byteLength(value.text, "utf8") <= 64 * 1024)
        answer = { action: "send", text: value.text };
    };
    try {
      this.bus.emit(CHILD_ENDED_CHANNEL, { ...structuredClone(event), reply } satisfies ChildEnded);
    } catch {
      /* A failing listener decides nothing. */
    }
    return answer;
  }
  /** Adds a status line to the conversation without starting a turn; the agent reads it next time. */
  async addStatus(text: string, details: StatusDetails): Promise<void> {
    const session = this.pi;
    if (!session || this.closed) throw new RuntimeError("not-found");
    await session.sendCustomMessage({ customType: STATUS_ENTRY, content: text, display: true, details }, { triggerTurn: false });
    this.host.storage.persistStatusHistory(session.sessionManager);
    this.host.storage.active(this.id);
    this.changed();
  }
  get extensionRevisions(): ExtensionRevisions {
    return new ExtensionRevisions(join(this.host.storage.directory(this.id), "extension-revisions"));
  }
  private resources?: object;
  private inspect(): string {
    return JSON.stringify({
      session: this.id, agent: this.metadata.agent, cwd: this.metadata.cwd, status: this.status,
      setupChanged: this.setupChanged, resources: this.resources, activeTools: this.pi?.getActiveToolNames(),
      local: this.extensionRevisions.read(), pending: this.host.pendingSetup?.(this.id) ?? null,
      offeredViews: this.views?.view().map(({ point, key, title }) => ({ point, key, title })),
      extensionErrors: this.extensionErrors,
      recentErrors: this.ui?.view().notices.filter(({ kind }) => kind === "error").slice(-5).map(({ lines }) => lines),
      viewStatus: "Contributions only; browser mounting is not verified.",
    }, null, 2);
  }
  private async extensionRequest(value: unknown): Promise<void> {
    const message = value as ExtensionMessage;
    if (!message?.request || typeof message.reply !== "function") return;
    message.taken = true;
    const { request, signal, reply } = message;
    const revisions = this.extensionRevisions;
    try {
      if (signal?.aborted || this.closed || !this.published || this.status !== "running") throw new Error("No active run.");
      if (this.host.extensionPending?.(this.id)) throw new Error("A reload is already pending.");
      if (this.extensionApproval) throw new Error("A revision is awaiting approval.");
      const folder = this.host.storage.directory(this.id);
      const draftRoot = join(folder, "extension-drafts");
      const assertQueue = () => {
        if (signal?.aborted || this.closed || this.run?.cancelled) throw new Error("The extension change cannot be scheduled while this turn is stopping.");
      };
      let change = revisions.read().staged;
      if (request.action === "apply" || request.action === "unload") {
        assertQueue();
        if (!extensionNameValid(request.name)) throw new Error("Invalid extension name.");
        const active = revisions.read().active.find((item) => item.name === request.name);
        if (request.action === "unload" && !active) return reply("That extension is already unloaded.");
        change = request.action === "apply"
          ? revisions.stage(draftRoot, request.name, request.name, folder)
          : revisions.stage(this.metadata.cwd, request.name);
        if (active && change.snapshot === active.snapshot) {
          const { staged, ...state } = revisions.read();
          revisions.write(state);
          return reply(`${change.name} is already active at revision ${active.revision}.`);
        }
      } else if (request.action === "stage" || request.action === "remove") {
        if (!extensionNameValid(request.name) || (request.action === "stage" && !request.source)) throw new Error("Invalid extension name or source.");
        const local = request.action === "stage" && request.scope === "session";
        change = revisions.stage(local ? draftRoot : this.metadata.cwd, request.name, request.action === "stage" ? request.source : undefined, local ? folder : undefined);
        return reply(`Staged ${change.name} at revision ${change.revision}. Active code has not changed.`);
      }
      if (!change || (request.action === "reload" && change.revision !== request.revision))
        throw new Error("Give the exact currently staged revision.");
      revisions.verify(change);
      if (change.snapshot && change.scope !== "session") {
        this.extensionApproval = true;
        try {
          const yes = await this.ui?.context.confirm("Activate this project extension in the session?", [
            `${change.name} (${change.source})`,
            `Revision: ${change.revision}`,
            "Extension code runs with the host user's permissions.",
          ].join("\n"));
          if (!yes) return reply("Activation declined. The active revision is unchanged.");
        } finally { this.extensionApproval = false; }
      }
      assertQueue();
      const what = `${change.snapshot ? "activation" : "unload"} of ${change.name}`;
      if (!this.host.requestSetup?.(this, { extension: change.revision, asked: `pispark_extension (${what} at revision ${change.revision})` }))
        throw new Error("A reload is already pending.");
      reply(`Scheduled ${what} when this turn ends. The session then reloads and you get the outcome as a new message; end your turn now rather than checking.`);
    } catch (error) { reply((error as Error).message.slice(0, 500), true); }
  }
  private extensionApproval = false;
  /** The last run was cancelled or failed: what was asked for from inside it is not carried out. */
  get lastRunStopped(): boolean { return this.lastRunCancelled; }
  private lastRunCancelled = false;
  /** A change to the session's setup failed: said in the session, as an extension's failure is. */
  setupNotice(text: string): void {
    this.ui?.failed(text);
  }
  /** The extension files the session loaded, for naming where a tool came from. */
  private extensionPaths: string[] = [];
  /** Tells the host which tools the running session has, so the agent editor knows them too. */
  private reportTools(): void {
    if (!this.pi || !this.metadata.setup) return;
    try {
      this.host.toolsSeen?.(this.metadata.setup, this.extensionPaths, this.pi.getAllTools());
    } catch {
      /* Only a listing. */
    }
  }
  /** The agent's last answer in this session: the text of its last reply that has any. */
  lastReply(): string | undefined {
    const messages = (this.pi?.messages ?? []) as { role?: string; content?: unknown }[];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
      const text = (message.content as { type?: string; text?: unknown }[])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("\n")
        .trim();
      if (text) return text;
    }
    return undefined;
  }

  /** Read a notice result from the transcript, even after reopening or changing the active branch. */
  childRunResult(id: string): (ChildRunResult & { answer?: string }) | undefined {
    const transcript = this.pi ? undefined : this.host.storage.validateHistory(this.metadata);
    const manager = this.pi?.sessionManager ?? (transcript ? SessionManager.open(transcript, this.host.storage.directory(this.id), this.metadata.cwd) : undefined);
    const entry = manager?.getEntry(id);
    if (!manager || entry?.type !== "custom" || entry.customType !== CHILD_RESULT_ENTRY) return undefined;
    const result = entry.data as ChildRunResult | undefined;
    if (!result || !["completed", "cancelled", "failed"].includes(result.outcome)) return undefined;
    const answer = result.answerId ? answerOf(manager.getEntry(result.answerId)) : undefined;
    return { ...result, ...(answer ? { answer } : {}) };
  }

  /** The built-in schedule tool: list, remove, or add after the person says yes. */
  private scheduleRequest(value: unknown): void {
    if (!validMessage(value)) return;
    const message: ScheduleMessage = value;
    message.taken = true;
    const schedules = this.host.schedules;
    const answer = async (): Promise<{ ok: boolean; text: string }> => {
      if (!schedules || !this.ui) return { ok: false, text: "Scheduling is not available here." };
      const { request } = message;
      const mine = schedules.of(this.id);
      if (request.action === "list")
        return {
          ok: true,
          text: mine.length
            ? mine.map((s) => `${s.id}: ${describeSchedule(s)} (${s.on ? "on" : "off"}): ${s.prompt}`).join("\n")
            : "This session has no schedules.",
        };
      if (request.action === "remove") {
        if (!mine.some((s) => s.id === request.id)) return { ok: false, text: "This session has no schedule with that id." };
        schedules.remove(request.id);
        return { ok: true, text: "Schedule removed." };
      }
      const { input } = request;
      const when = { cron: input.cron, at: input.at };
      if (input.cron !== undefined ? !parseCron(input.cron) : Number.isNaN(new Date(input.at ?? "").getTime()) || new Date(input.at!).getTime() <= Date.now())
        return { ok: false, text: "That is not a time that can be scheduled." };
      const yes = await this.ui.context.confirm("Schedule this in this session?", `${describeSchedule(when)}: ${input.prompt ?? ""}`);
      if (!yes) return { ok: true, text: "The person declined; nothing was scheduled." };
      const added = schedules.add(this.id, { ...when, prompt: input.prompt }, "agent");
      return { ok: true, text: `Scheduled: ${describeSchedule(added)} (id ${added.id}). The person can change it under Session info → Schedules.` };
    };
    void answer()
      .catch((error: unknown) => ({ ok: false, text: `Scheduling failed (${runtimeError(error, "execution").code}).` }))
      .then((result) => message.reply(result));
  }

  private onEvent(event: Parameters<Parameters<AgentSession["subscribe"]>[0]>[0]): void {
    // A running tool reports progress only as events. Keep the latest reference; it is projected
    // when a client asks, never here. Calls nested inside another tool are not shown.
    const tool = event as { type: string; toolCallId?: string; partialResult?: unknown; parentToolCallId?: string };
    if (tool.toolCallId && !tool.parentToolCallId) {
      if (tool.type === "tool_execution_start" || tool.type === "tool_execution_update") this.running.set(tool.toolCallId, tool.partialResult);
      else if (tool.type === "tool_execution_end") this.running.delete(tool.toolCallId);
    }
    if (event.type === "agent_settled") this.running.clear();
    // Pi retries a transient provider failure by itself; the session says so while it waits.
    if (event.type === "auto_retry_start")
      this.retrying = {
        attempt: event.attempt,
        of: event.maxAttempts,
        at: new Date(Date.now() + event.delayMs).toISOString(),
        failure: replyFailure({ stopReason: "error", errorMessage: event.errorMessage, provider: this.pi?.model?.provider } as AssistantMessage),
      };
    if (event.type === "auto_retry_end" || event.type === "agent_settled") this.retrying = undefined;
    if (event.type === "agent_start" && this.run) this.run.admissionClosed = false;
    if (event.type === "agent_settled" && this.run) this.run.settled = true;
    // A run Pi started by itself ends here; one PiSpark started ends where it was sent.
    if (event.type === "agent_settled" && this.settleAdopted) {
      const settle = this.settleAdopted;
      this.settleAdopted = undefined;
      settle();
    }
    // Pi's session name is the session title: an extension's pi.setSessionName renames the session.
    if (event.type === "session_info_changed" && event.name)
      try {
        this.setTitle(event.name);
      } catch (error) {
        // A closing session or an invalid name keeps the current title; a failed save is said.
        if (error instanceof RuntimeError && error.code === "storage") this.ui?.failed("The session title could not be saved.");
      }
    // A provider error is a failed run, unless the run was cancelled: then it is the cancel's result
    // (Pi records an error message for a run aborted before it reached the provider).
    // Each finished message is in the history now: the session did something.
    if (event.type === "message_end") this.host.storage.active(this.id);
    if (event.type === "message_end" && event.message.role === "assistant" && this.run && !this.run.cancelled) {
      const { stopReason, provider, errorMessage } = event.message;
      this.run.providerError = stopReason !== "error" ? undefined
        : providerUsageLimited(provider, errorMessage) ? "usage-limit" : "execution";
    }
    this.changed();
  }

  private setTitle(input: string): void {
    // A person's name for the session stays.
    if (this.metadata.renamed) return;
    if (
      !this.host.accepting() ||
      this.closed ||
      !this.host.holds(this) ||
      !this.pi ||
      !["idle", "running"].includes(this.status) ||
      this.cancelling ||
      (this.status === "running" && this.run?.cancelled)
    )
      throw new RuntimeError("closed");
    const metadata = { ...this.metadata, title: toolSessionTitle(input) };
    this.host.storage.write(metadata);
    this.metadata = metadata;
    this.changed();
  }
  /**
   * Between replies, the person chooses another model or thinking level for this session: Pi switches
   * (and records it in the transcript), and the session keeps the choice when it opens again.
   */
  async configure(change: { model?: ModelChoice; thinking?: ThinkingLevel }): Promise<void> {
    const { session } = this.loaded();
    // Between replies, a failed one included.
    if (!["idle", "error"].includes(this.status) || this.input || this.cancelling) throw new RuntimeError("busy");
    this.input = this.applyConfiguration(session, change);
    try {
      await this.input;
    } catch (error) {
      // Pi already applied the change. Discard that runtime rather than risk dispatch on an
      // unsaved choice. The next open uses the last committed session metadata.
      if (error instanceof RuntimeError && error.code === "storage") await this.stop();
      throw error;
    } finally {
      this.input = undefined;
      // Free again: anything that waited for this change can go now.
      this.changed();
    }
  }

  private async applyConfiguration(session: AgentSession, change: { model?: ModelChoice; thinking?: ThinkingLevel }): Promise<void> {
    // Pi resets thinking when the model changes; the level the session had goes on with it (clamped to what it offers).
    const thinking = change.thinking ?? this.metadata.thinking ?? (session.thinkingLevel as ThinkingLevel);
    const choice = change.model;
    if (choice) {
      // Pick up explicitly refreshed provider catalogs, including in an already-open session.
      const refreshed = await session.modelRuntime.refresh({ providers: [choice.provider], allowNetwork: false });
      if (refreshed.aborted || refreshed.errors.size) throw new RuntimeError("configuration");
      const model = session.modelRuntime.getModel(choice.provider, choice.id);
      if (!model || !(await session.modelRuntime.getAvailable(choice.provider)).some((m) => m.id === choice.id))
        throw new RuntimeError("model-unavailable");
      this.configuringModel = true;
      try {
        await session.setModel(model);
      } catch {
        throw new RuntimeError("credentials");
      } finally {
        this.configuringModel = false;
      }
    }
    session.setThinkingLevel(thinking);
    const metadata = { ...this.metadata };
    if (choice) metadata.model = { ...choice };
    // Kept with the session only when the person chose it; otherwise the agent's applies on reopen.
    if (change.thinking) metadata.thinking = session.thinkingLevel as ThinkingLevel;
    try {
      this.host.storage.write(metadata);
    } catch {
      throw new RuntimeError("storage");
    }
    this.metadata = metadata;
    this.changed();
  }
  /** Manual compaction uses Pi's own model, hooks, and transcript. */
  async compact(): Promise<void> {
    const { session } = this.loaded();
    if (!this.settled || !session.isIdle || !this.host.slots.take(this.id)) throw new RuntimeError("busy");
    this.compacting = true;
    this.touch();
    this.input = session.compact();
    this.changed();
    try {
      await this.input;
      this.host.storage.active(this.id);
    } catch (error) {
      if (error instanceof Error && /^(Already compacted|Nothing to compact)/.test(error.message))
        throw new RuntimeError("nothing-to-compact");
      if (error instanceof Error && error.message === "Compaction cancelled")
        throw new RuntimeError("compaction-cancelled");
      if (error instanceof Error && providerUsageLimited(session.model?.provider, error.message))
        throw new RuntimeError("usage-limit");
      throw new RuntimeError("execution");
    } finally {
      this.input = undefined;
      this.compacting = false;
      this.host.slots.release(this.id);
      this.changed();
    }
  }
  /** Files which reached the transcript, including earlier branches. */
  sentFiles(): Set<string> {
    return sentAttachmentNames(this.host.storage.directory(this.id), this.pi?.sessionManager.getEntries() ?? []);
  }
  /** A person looked at the session. */
  seen(at: string): void {
    const metadata: SessionMetadata = { ...this.metadata, seenAt: at };
    this.host.storage.write(metadata);
    this.metadata = metadata;
    this.changed();
  }
  /** A person names the session. Pi's session name follows, as in terminal Pi's `/name`. */
  rename(title: string): void {
    const metadata: SessionMetadata = { ...this.metadata, title, renamed: true };
    this.host.storage.write(metadata);
    this.metadata = metadata;
    if (this.pi && !this.closed) this.pi.setSessionName(title);
    this.changed();
  }
  /** An empty, never-started session is named after its first message until the agent names it. */
  private firstTitle(metadata: SessionMetadata, text: string): void {
    if (!metadata.title && !this.pi!.messages.some((message) => message.role === "user" || message.role === "assistant"))
      metadata.title = sessionTitle(namingFiles(text)) || "New session";
  }

  // ---- Runs and the queue ---------------------------------------------------------------------

  /**
   * Sends a prompt: it runs now if a run slot is free, else it waits for one in order. A waiting
   * prompt is saved with the session, so a restart keeps it.
   */
  start(text: string, marker?: WokenDetails): RunHandle {
    validateText(text);
    if (!this.host.accepting()) throw new RuntimeError("closed");
    this.loaded();
    if (this.status !== "idle" || this.input) throw new RuntimeError("busy");
    this.touch();
    if (!this.host.slots.take(this.id)) return { completion: this.enqueue(text, false, marker) };
    try {
      return { completion: this.begin(text, marker) };
    } catch (error) {
      this.host.slots.release(this.id);
      throw error;
    }
  }
  private restoreQueued(text: string): void {
    try {
      const run = this.host.slots.take(this.id) ? this.begin(text) : this.enqueue(text, true);
      void run.catch(() => {});
    } catch {
      // The prompt stays saved; it is offered again the next time the session opens.
      this.host.slots.release(this.id);
    }
  }
  private enqueue(text: string, restored = false, marker?: WokenDetails): Promise<RunResult> {
    const metadata = { ...this.metadata, queued: text };
    // A waiting first message already names the session, so the list can tell queued sessions apart.
    this.firstTitle(metadata, text);
    this.host.storage.write(metadata);
    this.metadata = metadata;
    this.restored = restored;
    this.status = "queued";
    this.error = undefined;
    this.changed();
    return new Promise<Promise<RunResult> | RunResult>((resolve) => {
      this.queuedRun = resolve;
      this.host.slots.wait(this.id, () => {
        this.queuedRun = undefined;
        this.restored = false;
        this.status = "idle";
        try {
          resolve(this.begin(text, marker));
        } catch (error) {
          this.host.slots.release(this.id);
          this.error = runtimeError(error, "storage").code;
          this.status = "error";
          this.changed();
          resolve({ outcome: "failed", error: this.error });
        }
      });
    }).then((result) => result);
  }
  /** Takes a queued prompt off the queue; a stopping session keeps it saved for its next start. */
  private unqueue(keep: boolean): void {
    this.host.slots.withdraw(this.id);
    const resolve = this.queuedRun;
    this.queuedRun = undefined;
    if (!keep && this.metadata.queued !== undefined) {
      const { queued: _queued, ...metadata } = this.metadata;
      try {
        this.host.storage.write(metadata);
      } catch {
        /* The prompt stays saved; it is offered again when the session opens. */
      }
      this.metadata = metadata;
    }
    if (this.status === "queued") this.status = "idle";
    this.restored = false;
    resolve?.({ outcome: "cancelled" });
    this.changed();
  }
  /**
   * The session starts working: saved as active before any model or tool side effect, shown as
   * running, bounded by the run deadline. `settle` ends the run, once.
   */
  private mark(text?: string): { run: Run; settle: () => RunResult } {
    const { host } = this;
    const started = Date.now();
    const manager = this.metadata.parent && this.metadata.report === "notice" ? this.pi?.sessionManager : undefined;
    const entryCount = manager?.getEntries().length ?? 0;
    this.resultData = undefined;
    this.runStartedAt = started;
    const { queued: _queued, ...current } = this.metadata;
    const metadata = { ...current, active: true, interrupted: false };
    if (text !== undefined) this.firstTitle(metadata, text);
    host.storage.write(metadata);
    this.metadata = metadata;
    this.status = "running";
    host.logger.event("session.start", { sessionId: this.id, outcome: "completed" });
    this.error = undefined;
    const run: Run = { cancelled: false, settled: false };
    this.run = run;
    this.touch();
    this.changed();
    const settle = (): RunResult => {
      run.settled = true;
      if (!run.cancelled) this.error ??= run.providerError;
      let childResult: RunResult["childResult"];
      this.metadata.active = !!this.error;
      this.metadata.interrupted ||= !!this.error;
      try {
        host.storage.write(this.metadata);
        if (manager) {
          const entries = manager.getEntries();
          // Pi only creates a persistent transcript after the first user or assistant message.
          if (entries.some((entry) => entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant"))) {
            const answerEntry = !this.error && !run.cancelled ? entries.slice(entryCount).findLast((entry) => answerOf(entry)) : undefined;
            const data: ChildRunResult = {
              outcome: this.error ? "failed" : run.cancelled ? "cancelled" : "completed",
              ...(this.error ? { error: this.error } : {}),
              ...(answerEntry ? { answerId: answerEntry.id } : {}),
              ...(this.resultData !== undefined ? { data: this.resultData } : {}),
            };
            const id = manager.appendCustomEntry(CHILD_RESULT_ENTRY, data);
            const answer = answerOf(answerEntry);
            childResult = { ...data, id, ...(answer ? { answer } : {}) };
          }
        }
      } catch {
        this.error = "storage";
        this.metadata.active = true;
      }
      if (this.status === "running") this.status = this.error ? "error" : "idle";
      this.paused = false;
      this.lastRunCancelled = run.cancelled || !!this.error;
      host.slots.withdraw(this.id);
      host.slots.release(this.id);
      this.touch();
      host.logger.event("session.settle", {
        sessionId: this.id,
        durationMs: Date.now() - started,
        outcome: this.error ? "failed" : run.cancelled ? "cancelled" : "completed",
        code: this.error,
      });
      this.changed();
      const result: RunResult = {
        ...(this.error ? { outcome: "failed", error: this.error } : { outcome: run.cancelled ? "cancelled" : "completed" }),
        ...(childResult ? { childResult } : {}),
      };
      setImmediate(() => {
        this.reportTools();
        host.ended?.(this, result);
      });
      return result;
    };
    return { run, settle };
  }
  /** Runs a prompt; the session holds a run slot. A wake says what woke it in the session first. */
  private begin(text: string, marker?: WokenDetails): Promise<RunResult> {
    const session = this.loaded().session;
    const { settle } = this.mark(text);
    if (marker) session.sessionManager.appendCustomEntry(WOKEN_ENTRY, marker);
    this.runDone = (async (): Promise<RunResult> => {
      try {
        // The agent's prompts work as /commands, as in terminal Pi. A cancel that arrives while Pi
        // prepares the run is caught where the provider would be called (beforeProviderDispatch).
        // Images a person attached go as content too; every attachment is also named in the text.
        const images = await attachedImages(this.host.storage.directory(this.id), text);
        await session.prompt(text, { expandPromptTemplates: true, source: "rpc", ...(images.length ? { images } : {}) });
        await session.waitForIdle();
      } catch (error) {
        this.error = runtimeError(error, "execution").code;
      }
      return settle();
    })();
    return this.runDone;
  }
  /**
   * A run Pi starts by itself (an extension's `pi.sendUserMessage`, or a custom message that
   * starts a turn) is a run like any other: shown as running, saved as active, stoppable, and
   * holding a run slot. Pi calls this before the agent starts and counts as busy meanwhile, so
   * past the limit the run waits here for its slot. Pi's `agent_settled` ends it.
   */
  private async adopt(): Promise<void> {
    // A prompt PiSpark sent is already a run. A session that is closing or failed takes none.
    if (this.status !== "idle" || this.closed || !this.pi || !this.host.accepting()) return;
    let marked: ReturnType<Session["mark"]>;
    try {
      marked = this.mark();
    } catch {
      // The session could not be saved as active; the run goes on as Pi started it.
      this.ui?.failed("The session could not be saved before an extension's run.");
      return;
    }
    this.runDone = new Promise<RunResult>((resolve) => (this.settleAdopted = () => resolve(marked.settle())));
    if (this.host.slots.take(this.id)) return;
    await new Promise<void>((go) => {
      // Cancelling or stopping lets it through without a slot (`wake`); it is then aborted.
      this.resuming = () => {
        this.resuming = undefined;
        go();
        this.changed();
      };
      this.host.slots.wait(this.id, this.resuming);
      this.changed();
    });
  }
  /** Waiting for a person, the run gives its slot to the next session. */
  private pause(): void {
    if (this.host.slots.release(this.id)) {
      this.paused = true;
      this.changed();
    }
  }
  /** Answered: the run needs a slot to go on, and goes before prompts that have not started. */
  private resume(go: () => void): void {
    if (!this.paused || this.status !== "running" || this.run?.cancelled) return go();
    const resume = () => {
      this.resuming = undefined;
      this.paused = false;
      go();
      this.changed();
    };
    if (this.host.slots.take(this.id)) resume();
    else {
      this.resuming = resume;
      this.host.slots.wait(this.id, resume, true);
      this.changed();
    }
  }
  /** A run that waits for a slot to go on is ending: let it go on now, without one. */
  private wake(): void {
    const resume = this.resuming;
    if (!resume) return;
    this.host.slots.withdraw(this.id);
    resume();
  }

  /** Steer or follow up the running agent, as Pi queues them. */
  async queue(text: string, kind: "steer" | "follow-up"): Promise<"queued" | "handled"> {
    validateText(text);
    if (kind !== "steer" && kind !== "follow-up") throw new RuntimeError("invalid-input");
    const { session } = this.loaded();
    if (!this.host.accepting()) throw new RuntimeError("closed");
    if (this.status !== "running" || this.input) throw new RuntimeError("busy");
    if (session.pendingMessageCount >= 8) throw new RuntimeError("limit");
    const run = this.run;
    if (!run || run.settled || run.admissionClosed || session.isIdle) throw new RuntimeError("busy");
    const valid = () => this.run === run && !run.settled && !run.cancelled && this.status === "running" && !session.isIdle;
    const input = inputAdmission.run({ valid }, async () => {
      const found = await attachedImages(this.host.storage.directory(this.id), text);
      const images = found.length ? found : undefined;
      const outcome = await (kind === "steer"
        ? session.steer(text, images, { source: "rpc" })
        : session.followUp(text, images, { source: "rpc" }));
      if (!valid()) throw new RuntimeError("busy");
      return outcome;
    });
    this.input = input;
    try {
      return await deadline(input, this.host.timeout);
    } catch (error) {
      if (error instanceof RuntimeError && error.code === "busy") throw error;
      this.error = runtimeError(error, "extension").code;
      void this.cancel("input-failure").catch(() => {});
      throw runtimeError(error, "extension");
    } finally {
      void input
        .finally(() => {
          if (this.input === input) this.input = undefined;
          this.changed();
        })
        .catch(() => {});
    }
  }

  /** Cancel the running agent, or take a queued prompt off the queue. Cooperative; cannot undo tool effects. */
  async cancel(source: "command" | "extension-abort" | "input-failure" | "parent-request" = "command"): Promise<void> {
    const { session } = this.loaded();
    if (this.loading) throw new RuntimeError("busy");
    // A prompt that has not started yet simply leaves the queue.
    if (this.status === "queued") return this.unqueue(false);
    if (!this.cancelling) {
      this.host.logger.event("session.cancel", { sessionId: this.id, outcome: "completed", code: source });
      if (this.run) this.run.cancelled = true;
      // Questions an extension is waiting on, or an answered one waiting for a slot, would hold the run open.
      this.ui?.dismissAll();
      this.wake();
      if (this.status !== "stopping") this.status = "cancelling";
      this.changed();
      this.cancelling = (async () => {
        await this.drain(session);
        await this.runDone;
        if (this.status !== "stopping") this.status = this.error ? "error" : "idle";
        this.changed();
      })().finally(() => (this.cancelling = undefined));
    }
    try {
      await deadline(this.cancelling, this.host.timeout);
    } catch (error) {
      this.error = runtimeError(error, "execution").code;
      this.changed();
      throw runtimeError(error, "execution");
    }
  }
  /** Clear Pi's queues and abort, again after input that was still being prepared. */
  private async drain(session: AgentSession): Promise<void> {
    session.clearQueue();
    await session.abort();
    await this.input?.catch(() => {});
    session.clearQueue();
    await session.abort();
  }

  // ---- Stopping -------------------------------------------------------------------------------

  /** Stop the session: end any run, let extensions shut down, release it. History stays. */
  stop(reason: "quit" | "reload" = "quit"): Promise<void> {
    if (!this.stopping) {
      this.shutdownReason = reason;
      this.status = "stopping";
      if (this.run) this.run.cancelled = true;
      this.changed();
      this.stopping = this.dispose();
    }
    return deadline(this.stopping, this.host.timeout);
  }
  /** Why extensions are told the session shuts down: it quits, or it stops to open again (`reload`). */
  private shutdownReason: "quit" | "reload" = "quit";
  private async dispose(): Promise<void> {
    if (this.queuedRun) this.unqueue(true);
    if (this.run) this.run.cancelled = true;
    this.ui?.dismissAll();
    this.wake();
    this.status = "stopping";
    this.closed = true;
    this.ui?.close();
    this.views?.close();
    let cleanupError: RuntimeErrorCode | undefined;
    const session = this.pi;
    if (session) {
      await this.drain(session);
      await this.runDone;
      await this.cancelling;
      const beforeShutdown = this.extensionErrors;
      await session.extensionRunner.emit({ type: "session_shutdown", reason: this.shutdownReason });
      if (this.extensionErrors !== beforeShutdown) cleanupError = "extension";
      await session.settingsManager.flush();
      if (session.settingsManager.drainErrors().length) cleanupError = "storage";
      this.unsubscribe?.();
      session.dispose();
      this.metadata.active = this.error === "storage";
      try {
        if (this.published) this.host.storage.write(this.metadata);
      } catch {
        cleanupError = "storage";
      }
    }
    if (cleanupError) this.error = cleanupError;
    this.status = "stopped";
    this.changed();
    for (const observer of this.observers) observer.close();
    this.host.released(this);
    if (cleanupError) throw new RuntimeError(cleanupError);
  }
}

/** How full the model's context is, from Pi; nothing when the model has no known window. */
function contextOf(session: AgentSession): { context?: { tokens: number | null; window: number; percent: number | null } } {
  const usage = session.getContextUsage();
  if (!usage) return {};
  return { context: { tokens: usage.tokens, window: usage.contextWindow, percent: usage.percent === null ? null : Math.round(usage.percent * 10) / 10 } };
}
