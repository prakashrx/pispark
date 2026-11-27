import { AsyncLocalStorage } from "node:async_hooks";
import { basename, dirname, join } from "node:path";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, EventBus, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Provider } from "@earendil-works/pi-ai";
import { NOTICE_ENTRY, type ReadOnlyReason, type ItemsPage, type LiveDoc, type PartPage, type PendingSetup, type SessionCommand, type SessionDoc } from "../../contract/protocol.js";
import { ExtensionUI } from "../extensions/extension-ui.js";
import { ExtensionRendering } from "../extensions/extension-render.js";
import { ExtensionViews } from "../extensions/views.js";
import type { Json } from "../../contract/stream-ops.js";
import type { SafeLogger } from "../logger.js";
import type { Setup } from "../agents/resolve.js";
import type { SessionAgent, ThinkingLevel } from "../../contract/agent-protocol.js";
import type { ModelChoice } from "../../contract/provider-protocol.js";
import { sessionTitle } from "../../contract/session-title.js";
import { TITLE_TOOL, toolSessionTitle } from "./session-title.js";
import { attachedImages, sentAttachmentNames, namingFiles } from "./attachments.js";
import { ExtensionRevisions, type ExtensionChange } from "./extension-revisions.js";
import { SessionRequests } from "./session-requests.js";
import type { SetupChange } from "./setup-changes.js";
import { EXTENSION_TOOL } from "./extension-tool.js";
import { createSessionServices, resolveFolder } from "./configuration.js";
import { providerUsageLimited, deadline, replyFailure, RuntimeError, runtimeError, unsupported } from "./errors.js";
import type { RuntimeErrorCode } from "./errors.js";
import { ItemProjector, progressOf } from "./items.js";
import { contextBudget, SUMMARY_FOCUS } from "./compaction.js";
import { LiveView } from "./live-view.js";
import { SessionChanges } from "./observation.js";
import type { SessionChange } from "./observation.js";
import type { ProviderSettings } from "./provider-settings.js";
import type { RunSlots } from "./run-slots.js";
import type { SessionMetadata, SessionStorage } from "./storage.js";
import { STATUS_ENTRY, WOKEN_ENTRY, type StatusDetails, type WokenDetails } from "../../contract/wake-protocol.js";
import type { Schedule, ScheduleInput } from "../../contract/schedule-protocol.js";
import { HEARD_CHANNEL, toolOf, type Answer, type Heard, type Verb } from "../../contract/verbs.js";

/**
 * A session started by another one is a worker. It keeps the six verbs a worker needs (start a
 * process, wait, look, stop, raise, note) and has none of these: it starts no sessions, and it is
 * named by its parent or from its brief, so it does not name itself.
 */
const NOT_FOR_CHILDREN = [TITLE_TOOL, ...(["start_session", "schedule", "send", "self"] as const).map(toolOf)];

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
  /** Cancelled by the person, with Stop. */
  by?: "person";
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
  /** The verbs a session says about what it started (`contract/verbs.ts`), and the handle of something it started. */
  readonly started?: {
    say(sessionId: string, verb: Exclude<Verb, { verb: "self" | "schedule" }>, signal?: AbortSignal): Promise<Answer>;
    handle(sessionId: string, kind: string, id: string): string;
  };
  /** The tools a running session of a setup has (`fingerprint`), from Pi's `getAllTools`. */
  toolsSeen?(fingerprint: string, extensionPaths: string[], tools: { name: string; description?: string; sourceInfo?: { path?: string } }[]): void;
  /** An extension asks to keep the session loaded (or lets go). */
  hold?(session: Session, request: { extension: string; hold: boolean; reason: string }): { state: "held" | "asked" | "released" | "refused"; text: string };
  /** One of the session's runs ended (a child reports back). Called outside Pi's listeners. */
  ended?(session: Session, result: RunResult): void;
  /** A message from above reached the session while it works: a wait inside its turn ends early. */
  arrived?(session: Session): void;
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
  /** A new session from this one's history up to an entry (an extension command's `ctx.fork`). */
  fork?(session: Session, entryId: string): Promise<string>;
  /** Adding a schedule to a session, for its agent (`pispark_schedule`). */
  readonly schedules?: {
    /** Throws as `add` would, without saving. */
    validate(sessionId: string, input: ScheduleInput): void;
    add(sessionId: string, input: ScheduleInput, by: "agent"): Schedule;
  };
}

/** One run's identity: whether it was cancelled, settled, and whether it may still take input. */
interface Run {
  providerError?: "execution" | "usage-limit";
  cancelled: boolean;
  /** The person cancelled it, with Stop. */
  byPerson?: true;
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

/** Kept at the point the person moved the session to, so it opens there again (`Session.navigate`). */
const BRANCH_ENTRY = "pispark:branch";

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
  /** The person's message, held while the context is compacted before it is sent. */
  private sending?: string;
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
  /** What its tools and extensions ask of PiSpark on its bus. */
  private readonly requests: SessionRequests;

  constructor(
    private readonly host: SessionHost,
    metadata: SessionMetadata,
    reopening: boolean,
    /** Opened again by a reload: extensions are told `session_start` with reason `reload`, as Pi's own reload does. */
    private readonly reloading = false,
  ) {
    this.metadata = metadata;
    this.published = reopening;
    this.requests = new SessionRequests(this, host, {
      ui: () => this.ui,
      closed: () => this.closed,
      cancelled: () => !!this.run?.cancelled,
      inspect: () => this.inspect(),
    });
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
      ...(this.sending !== undefined ? { queuedText: this.sending } : {}),
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

  /**
   * Opens the session: what it needs to run (folder, agent, model), its history, its extensions and
   * Pi's agent session, then the extensions bound in Pi's mode for clients that are not a terminal.
   */
  private async initialize(): Promise<SessionDoc> {
    const reopening = this.published;
    const needs = await this.needs(reopening);
    if (typeof needs === "string") return this.openReadOnly(needs);
    const { cwd, setup, model } = needs;
    const { dir, manager } = this.openHistory(cwd, setup, model, reopening);
    // Before extensions load: they may place components and raise notices while loading.
    const ui = this.createUi(cwd);
    const { extensionPaths, views } = this.loadExtensions(setup, ui);
    const services = await this.services(setup, extensionPaths, views, cwd, dir, model);
    const session = await this.createPi(services, manager, setup, cwd, dir, reopening);
    this.unsubscribe = session.subscribe((event) => this.onEvent(event));
    const rendering = new ExtensionRendering(session, () => this.changed());
    this.items = new ItemProjector(session, rendering, (customType) => views.has(`item.custom:${customType}`));
    await this.bindExtensions(session, ui);
    await views.finishActivation().catch(() => {
      throw new RuntimeError("extension");
    });
    if (this.error) throw new RuntimeError(this.error);
    if (this.closed) throw new RuntimeError("timeout");
    return this.opened(setup, services.resourceLoader, reopening);
  }

  /**
   * The folder, agent and model the session runs with. When one of them can't be had, a session with a
   * past opens to be read: the answer is which one.
   */
  private async needs(reopening: boolean): Promise<{ cwd: string; setup: Setup; model: Awaited<ReturnType<SessionHost["model"]>> } | ReadOnlyReason> {
    const { metadata, host } = this;
    let step: ReadOnlyReason = "folder";
    try {
      const cwd = await resolveFolder(metadata.cwd);
      step = "agent";
      let setup: Setup;
      try {
        setup = host.setup(metadata);
      } catch {
        throw new RuntimeError("agent");
      }
      step = "model";
      return { cwd, setup, model: await host.model(metadata, setup) };
    } catch (error) {
      if (reopening && host.accepting()) return step;
      throw error;
    }
  }

  /** Records what the session runs with and opens Pi's transcript of it, or a new one. */
  private openHistory(cwd: string, setup: Setup, { managed, fixed }: Awaited<ReturnType<SessionHost["model"]>>, reopening: boolean) {
    const { metadata, host } = this;
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
    return { dir, manager };
  }

  /** What its extensions show and ask through Pi's `ctx.ui`; notices are kept in the session's history once it is open. */
  private createUi(cwd: string): ExtensionUI {
    return (this.ui = new ExtensionUI({
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
  }

  /** The extensions to load: the agent's, and the session's own active (or about to be activated) revisions. */
  private loadExtensions(setup: Setup, ui: ExtensionUI): { extensionPaths: string[]; views: ExtensionViews } {
    const { host } = this;
    const revisions = this.extensionRevisions;
    const candidates = host.extensionCandidate?.(this.id);
    const active = candidates ?? revisions.read().active;
    const activating = candidates?.find((change) => change.revision === host.extensionPending?.(this.id));
    for (const change of active) revisions.verify(change);
    const extensionPaths = [...setup.extensionPaths, ...active.map((change) => revisions.loadPath(change))];
    const views = (this.views = new ExtensionViews(
      extensionPaths.map((path) => dirname(path)),
      {
        changed: () => this.changed(),
        failed: (message) => ui.failed(message),
        callTimeoutMs: host.callTimeout,
        points: host.points,
        ...(activating ? { activationFolder: dirname(revisions.loadPath(activating)) } : {}),
      },
    ));
    return { extensionPaths, views };
  }

  /** Pi's services for this session, with PiSpark's admission hooks and its requests on the session's bus. */
  private services(setup: Setup, extensionPaths: string[], views: ExtensionViews, cwd: string, dir: string, { managed, fixed }: Awaited<ReturnType<SessionHost["model"]>>) {
    const { metadata, host } = this;
    const development = !setup.toolsOff.includes(EXTENSION_TOOL);
    return createSessionServices({
      setup: { ...setup, extensionPaths, toolsOff: [...setup.toolsOff, ...(metadata.parent ? NOT_FOR_CHILDREN : [])] },
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
        requests: {
          bind: (bus) => {
            this.bus = bus;
            return this.requests.bind(bus, development);
          },
        },
      },
    });
  }

  /** Pi's agent session on the transcript, at the session's model and thinking level. */
  private async createPi(services: Awaited<ReturnType<typeof createSessionServices>>, manager: SessionManager, setup: Setup, cwd: string, dir: string, reopening: boolean): Promise<AgentSession> {
    const { metadata } = this;
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
    if (session.model?.provider !== metadata.model!.provider || session.model?.id !== metadata.model!.id) throw new RuntimeError("configuration");
    if (this.error) throw new RuntimeError(this.error);
    return session;
  }

  /** Binds the extensions in Pi's mode for clients that are not a terminal: dialogs and notices work, terminal components don't. */
  private async bindExtensions(session: AgentSession, ui: ExtensionUI): Promise<void> {
    await session.bindExtensions({
      mode: "rpc",
      uiContext: ui.context,
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: unsupported,
        // Pi's fork replaces the terminal's session; here it is a new session of its own, next to this one.
        fork: async (entryId, options) => {
          if (options?.withSession) throw new Error("withSession is not available in PiSpark: the fork is a session of its own.");
          const entry = session.sessionManager.getEntry(entryId);
          const position = options?.position ?? "before";
          if (!entry || (position === "before" && (entry.type !== "message" || entry.message.role !== "user"))) throw new Error("Invalid entry ID for forking");
          const at = position === "at" ? entry.id : entry.parentId;
          if (!at) throw new Error("There is nothing before this message to fork.");
          if (!this.host.fork) throw new Error("Forking is not available here.");
          await this.host.fork(this, at);
          ui.context.notify("Forked into a new session.", "info");
          return { cancelled: false };
        },
        // Pi's own tree navigation, in place.
        navigateTree: (targetId, options) => session.navigateTree(targetId, options),
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
  }

  /** The session is open: what it loaded is noted, it is saved and published, and a waiting prompt rejoins the queue. */
  private opened(setup: Setup, resources: Awaited<ReturnType<typeof createSessionServices>>["resourceLoader"], reopening: boolean): SessionDoc {
    const { metadata, host } = this;
    this.extensionPaths = setup.extensionPaths;
    this.resources = {
      skills: resources.getSkills().skills.map(({ name, filePath }) => ({ name, filePath })),
      prompts: resources.getPrompts().prompts.map(({ name }) => name),
      context: resources.getAgentsFiles().agentsFiles.map(({ path }) => path),
      extensions: resources
        .getExtensions()
        .extensions.filter((extension) => !extension.path.startsWith("<inline:"))
        .map((extension) => ({ path: extension.path, tools: [...extension.tools.keys()], commands: [...extension.commands.keys()] })),
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

  /**
   * Tells this session's extensions what reaches the session, before its agent hears of it. Their
   * synchronous reply decides: take it, reword it, or (no reply) let it through (see `HEARD_CHANNEL`).
   */
  hear(event: Omit<Heard, "reply">): { action: "skip" } | { action: "send"; text: string } | undefined {
    if (!this.bus) return undefined;
    let answer: { action: "skip" } | { action: "send"; text: string } | undefined;
    const reply: Heard["reply"] = (value) => {
      if (answer || !value || typeof value !== "object") return;
      if (value.action === "skip") answer = { action: "skip" };
      else if (value.action === "send" && typeof value.text === "string" && value.text.trim() && Buffer.byteLength(value.text, "utf8") <= 64 * 1024)
        answer = { action: "send", text: value.text };
    };
    try {
      this.bus.emit(HEARD_CHANNEL, { ...structuredClone(event), reply } satisfies Heard);
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
      session: this.id, startedBy: this.startedBy, agent: this.metadata.agent, model: this.metadata.model && `${this.metadata.model.provider}/${this.metadata.model.id}`,
      cwd: this.metadata.cwd, status: this.status,
      setupChanged: this.setupChanged, resources: this.resources, activeTools: this.pi?.getActiveToolNames(),
      local: this.extensionRevisions.read(), pending: this.host.pendingSetup?.(this.id) ?? null,
      offeredViews: this.views?.view().map(({ point, key, title }) => ({ point, key, title })),
      extensionErrors: this.extensionErrors,
      recentErrors: this.ui?.view().notices.filter(({ kind }) => kind === "error").slice(-5).map(({ lines }) => lines),
      viewStatus: "Contributions only; browser mounting is not verified.",
    }, null, 2);
  }
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
  /** The title of the session that started this one, for telling its agent who asked. */
  private get startedBy(): string | undefined {
    const { parent } = this.metadata;
    if (!parent) return undefined;
    try {
      return this.host.storage.read(parent).title ?? "a session";
    } catch {
      return "a session";
    }
  }
  /** Its parent asks it something: what it says from here until it is at rest is its answer. A message while an ask is open is part of that ask. */
  openAsk(): void {
    if (this.metadata.ask) return;
    const { note: _note, ...rest } = this.metadata;
    this.metadata = { ...rest, ask: { from: this.pi?.sessionManager.getEntries().length ?? 0 } };
    this.host.storage.write(this.metadata);
  }
  /** It notes or raises with whoever asked it: kept for whoever looks at it, a raise until it is answered. */
  up(word: "raise" | "note", text: string): void {
    this.metadata = { ...this.metadata, [word]: text.length > 500 ? `${text.slice(0, 499)}…` : text };
    this.host.storage.write(this.metadata);
    this.changed();
  }
  /** Whoever it raised with says something to it: that is its answer. */
  private answered(marker?: WokenDetails): void {
    if (this.metadata.raise === undefined || (marker && marker.source.id !== this.metadata.parent)) return;
    const { raise: _raise, ...rest } = this.metadata;
    this.metadata = rest;
    this.host.storage.write(this.metadata);
  }
  /**
   * Its answer goes to its parent: what the agent said at the end of each of its turns since it
   * was asked, in order. Closing the ask closes what it raised under it.
   */
  closeAsk(): string[] {
    const { ask, raise: _raise, ...rest } = this.metadata;
    if (!ask) return [];
    const replies: string[] = [];
    let last: string | undefined;
    for (const entry of this.pi?.sessionManager.getEntries().slice(ask.from) ?? []) {
      if (entry.type === "message" && entry.message.role === "user") {
        if (last) replies.push(last);
        last = undefined;
      } else last = answerOf(entry) ?? last;
    }
    if (last) replies.push(last);
    this.metadata = rest;
    this.host.storage.write(this.metadata);
    return replies;
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
    // Pi compacts by itself when the context nearly fills in the middle of a run; the session says so.
    if ((event.type === "compaction_start" || event.type === "compaction_end") && event.reason !== "manual")
      this.compacting = event.type === "compaction_start";
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
  /**
   * Moves the session to another point of its history with Pi's own tree navigation (in place, in
   * the same transcript): to just before one of the person's messages, to send it again edited, or
   * onto another branch. Only between replies. A move that sends nothing is kept with a hidden entry
   * at the new point, so the session opens there again.
   */
  async navigate(entryId: string, keep: boolean): Promise<void> {
    const { session } = this.loaded();
    if (!this.settled || !session.isIdle || this.compacting) throw new RuntimeError("busy");
    if (!session.sessionManager.getEntry(entryId)) throw new RuntimeError("not-found");
    this.touch();
    this.input = session.navigateTree(entryId).then((result) => {
      // An extension's session_before_tree handler can refuse the move.
      if (result.cancelled) throw new RuntimeError("extension");
      if (keep) session.sessionManager.appendCustomEntry(BRANCH_ENTRY, {});
    });
    this.changed();
    try {
      await this.input;
    } catch (error) {
      throw runtimeError(error, "execution");
    } finally {
      this.input = undefined;
      this.changed();
    }
  }
  /** Manual compaction uses Pi's own model, hooks, and transcript. */
  async compact(): Promise<void> {
    const { session } = this.loaded();
    if (!this.settled || !session.isIdle || !this.host.slots.take(this.id)) throw new RuntimeError("busy");
    this.compacting = true;
    this.touch();
    this.input = session.compact(SUMMARY_FOCUS);
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
  /** An entry of the session's transcript, on any branch. */
  entryOf(entryId: string): SessionEntry | undefined {
    return this.loaded().session.sessionManager.getEntry(entryId);
  }
  /** The newest point under an entry: following its latest child each time, down to an entry with none. */
  latestUnder(entryId: string): string | undefined {
    const manager = this.loaded().session.sessionManager;
    if (!manager.getEntry(entryId)) return undefined;
    const children = new Map<string, SessionEntry[]>();
    for (const entry of manager.getEntries())
      if (entry.parentId) children.set(entry.parentId, [...(children.get(entry.parentId) ?? []), entry]);
    let at = entryId;
    for (;;) {
      const next = children.get(at)?.reduce((a, b) => (a.timestamp >= b.timestamp ? a : b));
      if (!next) return at;
      at = next.id;
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
    this.answered(marker);
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
      this.metadata.active = !!this.error;
      this.metadata.interrupted ||= !!this.error;
      try {
        host.storage.write(this.metadata);
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
      const result: RunResult = this.error
        ? { outcome: "failed", error: this.error }
        : run.cancelled
          ? { outcome: "cancelled", ...(run.byPerson ? { by: "person" as const } : {}) }
          : { outcome: "completed" };
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
    const { run, settle } = this.mark(text);
    if (marker) session.sessionManager.appendCustomEntry(WOKEN_ENTRY, marker);
    this.runDone = (async (): Promise<RunResult> => {
      try {
        await this.compactBeforeSending(session, text);
        if (run.cancelled) return settle();
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
   * Between the person's messages, a context past its budget (`contextBudget`) is compacted before
   * the next message is sent, so Pi seldom has to compact in the middle of the work. The message
   * shows as waiting meanwhile. Nothing to compact, or a failed summary, sends it as it is; Pi's own
   * threshold stays.
   */
  private async compactBeforeSending(session: AgentSession, text: string): Promise<void> {
    const usage = session.getContextUsage();
    if (!usage?.tokens || usage.tokens <= contextBudget(usage.contextWindow, session.model?.cost)) return;
    this.compacting = true;
    this.sending = text;
    this.input = session.compact(SUMMARY_FOCUS);
    this.changed();
    try {
      await this.input;
    } catch {
      /* Sent as it is. A stop during the summary cancels the run, which the caller checks. */
    } finally {
      this.input = undefined;
      this.compacting = false;
      this.sending = undefined;
      this.changed();
    }
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
    this.answered();
    // It is meant to be read at the next pause, so a wait in the turn does not hold it up.
    if (kind === "steer") this.host.arrived?.(this);
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
      if (this.run && source === "command") this.run.byPerson = true;
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
