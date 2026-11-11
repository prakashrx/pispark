import { AsyncLocalStorage } from "node:async_hooks";
import { basename, dirname, join } from "node:path";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import { NOTICE_ENTRY, type ItemsPage, type LiveDoc, type PartPage, type SessionDoc } from "../../contract/protocol.js";
import { ExtensionUI } from "../extensions/extension-ui.js";
import { ExtensionRendering } from "../extensions/extension-render.js";
import { ExtensionViews } from "../extensions/views.js";
import type { Json } from "../../contract/stream-ops.js";
import type { SafeLogger } from "../logger.js";
import type { Setup } from "../personas/resolve.js";
import type { ChatPersona } from "../../contract/persona-protocol.js";
import { chatTitle } from "../../contract/chat-title.js";
import { toolChatTitle } from "./chat-title.js";
import { createSessionServices, resolveFolder } from "./configuration.js";
import { deadline, RuntimeError, runtimeError, unsupported } from "./errors.js";
import type { RuntimeErrorCode } from "./errors.js";
import { ItemProjector, progressOf } from "./items.js";
import { LiveView } from "./live-view.js";
import { SessionChanges } from "./observation.js";
import type { SessionChange } from "./observation.js";
import type { ProviderSettings } from "./provider-settings.js";
import type { RunSlots } from "./run-slots.js";
import type { ChatMetadata, ChatStorage } from "./storage.js";

export type SessionStatus =
  | "starting"
  | "idle"
  /** A prompt waits for a free run slot. */
  | "queued"
  | "running"
  | "cancelling"
  | "stopping"
  | "error"
  | "stopped";
export interface SessionSummary {
  id: string;
  /** Working folder on this host. */
  folder: string;
  createdAt: string;
  title?: string;
  hasHistory?: boolean;
  status: SessionStatus | "unloaded";
  interrupted: boolean;
  persona: ChatPersona;
  /** The persona changed since this session started; reload to apply. */
  personaChanged?: boolean;
  /** An extension asked a question and the run waits for an answer. */
  waiting?: boolean;
  /** Waits for a free run slot: a prompt that has not started, or a run resuming after an answer. */
  queued?: boolean;
}
export interface RunResult {
  outcome: "completed" | "cancelled" | "failed";
  error?: RuntimeErrorCode;
}
export interface RunHandle {
  completion: Promise<RunResult>;
}
type ModelSelection = Awaited<ReturnType<ProviderSettings["select"]>>;

/** What a chat needs from the runtime that holds it. */
export interface ChatHost {
  readonly storage: ChatStorage;
  readonly slots: RunSlots;
  readonly logger: SafeLogger;
  readonly timeout: number;
  readonly runTimeout: number;
  readonly callTimeout?: number;
  /** The places the client draws extension components in. */
  readonly places?: readonly string[];
  /** Whether the runtime still takes new work. */
  accepting(): boolean;
  /** Whether this chat is the one the runtime holds for its id. */
  holds(chat: Chat): boolean;
  /** The chat's persona, resolved now. */
  setup(metadata: ChatMetadata): Setup;
  /** The model the chat runs: a provider's (chosen as Ask, persona and defaults say) or the tests' fixed one. */
  model(metadata: ChatMetadata, setup: Setup): Promise<{ managed?: ModelSelection; fixed?: { provider: Provider; id: string } }>;
  /** The chat as the list shows it. */
  summary(chat: Chat): SessionSummary;
  /** The chat has stopped and is no longer held. */
  released(chat: Chat): void;
}

/** One run's identity: whether it was cancelled, settled, and whether it may still take input. */
interface Run {
  cancelled: boolean;
  settled: boolean;
  /** Settling: no new steer or follow-up may join this run. */
  admissionClosed?: boolean;
}

/** Steer and follow-up input being prepared knows which run it belongs to. */
const inputAdmission = new AsyncLocalStorage<{ valid: () => boolean }>();

/** "extensions/notes.ts" and "extensions/notes/index.ts" are both "notes". */
function extensionName(path: string): string {
  const name = basename(path).replace(/\.[^.]+$/, "");
  return name === "index" ? basename(dirname(path)) : name;
}
export function validateText(text: string): void {
  if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text, "utf8") > 64 * 1024)
    throw new RuntimeError("invalid-input");
}

/**
 * One chat while it is loaded: its Pi session, what its extensions show, and its lifecycle.
 *
 *   starting → idle ⇄ (queued →) running → cancelling → idle | error
 *   any → stopping → stopped (released)
 *
 * A run holds one of the runtime's run slots while its agent works, gives it up while an extension
 * waits for a person, and needs one again to go on.
 */
export class Chat {
  status: SessionStatus = "starting";
  metadata: ChatMetadata;
  error?: RuntimeErrorCode;
  /** Opened from history (or already published), as opposed to being created now. */
  published: boolean;
  /** When the chat was last used: shown, sent to, answered, called. Idle chats unload after a while. */
  lastUsed = Date.now();
  setupChanged = false;
  loading?: Promise<SessionDoc>;
  stopping?: Promise<void>;
  readonly observers = new Set<SessionChanges>();

  private session?: AgentSession;
  private ui?: ExtensionUI;
  private views?: ExtensionViews;
  private items?: ItemProjector;
  private sequence = 0;
  private closed = false;
  private extensionErrors = 0;
  private unsubscribe?: () => void;
  /** The current (or last) run and its completion. */
  private run?: Run;
  private runDone?: Promise<RunResult>;
  /** Steer or follow-up input being prepared. */
  private input?: Promise<unknown>;
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

  constructor(
    private readonly host: ChatHost,
    metadata: ChatMetadata,
    reopening: boolean,
  ) {
    this.metadata = metadata;
    this.published = reopening;
  }

  get id(): string {
    return this.metadata.id;
  }
  /** Loaded and ready for clients. */
  get ready(): boolean {
    return !!this.session && !!this.items;
  }
  /** Pi has written the chat's transcript; once it has, it always has. */
  get hasHistory(): boolean {
    return (this.historySeen ||= this.host.storage.hasHistory(this.id));
  }
  private historySeen = false;
  get asking(): boolean {
    return !!this.ui?.asking;
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
  }
  /**
   * Whether the chat can be unloaded without anyone noticing: nothing runs, waits or is queued in
   * it, no question is open, and nobody has it on screen.
   */
  get unloadable(): boolean {
    return (
      (this.status === "idle" || this.status === "error") &&
      !this.loading &&
      !this.input &&
      !this.queuedRun &&
      this.observers.size === 0 &&
      !this.asking &&
      !this.host.slots.holds(this.id) &&
      !this.host.slots.queued(this.id)
    );
  }
  /** After a persona edit: whether the resolved setup still matches the one the session started with. */
  checkSetup(fingerprint: string): void {
    if (!this.session || this.status === "stopping") return;
    const changed = fingerprint !== this.metadata.setup;
    if (changed !== this.setupChanged) {
      this.setupChanged = changed;
      this.changed();
    }
  }

  // ---- What clients read ----------------------------------------------------------------------

  private loaded(): { session: AgentSession; items: ItemProjector } {
    if (!this.session || !this.items) throw new RuntimeError("not-found");
    return { session: this.session, items: this.items };
  }
  /** Everything about the chat except its history: status, model, queue and what extensions show. */
  doc(): SessionDoc {
    const { session } = this.loaded();
    return {
      ...this.host.summary(this),
      model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined,
      queue: { steering: session.getSteeringMessages().length, followUp: session.getFollowUpMessages().length },
      ...(this.status === "queued" && this.metadata.queued !== undefined ? { queuedText: this.metadata.queued } : {}),
      ...(this.status === "queued" && this.restored ? { restored: true as const } : {}),
      error: this.error,
      extensions: {
        ...(this.ui?.view() ?? { dialogs: [], statuses: [], widgets: [], notices: [] }),
        views: this.views?.view() ?? [],
      },
    };
  }
  /** The live document: session state, the items in flight and what running tools reported. */
  liveDoc(): LiveDoc {
    return { session: this.doc(), tail: this.loaded().items.tail(), progress: progressOf(this.running) };
  }
  /** Finalized items on the chat's active branch, read straight from Pi's session. */
  page(options: { before?: string; after?: string; limit?: number }): ItemsPage {
    return this.loaded().items.page(options);
  }
  image(itemId: string, part: number) {
    return this.loaded().items.image(itemId, part);
  }
  text(itemId: string, part: number, offset: number): PartPage {
    return this.loaded().items.text(itemId, part, offset);
  }
  /** A connection's live view of the chat, and the invalidations that say when to ask it for more. */
  observe(): { view: LiveView; events: AsyncIterableIterator<SessionChange> & { close(): void } } {
    const { items } = this.loaded();
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
  call(slot: string, key: string, name: string, data?: Json): Promise<Json | undefined> {
    this.loaded();
    this.touch();
    if (!this.views) throw new RuntimeError("not-found");
    return this.views.call(slot, key, name, data);
  }
  /** An extension component's `host.file`: a file in the folder its own placement named. */
  file(slot: string, key: string, path: string): string {
    this.loaded();
    this.touch();
    if (!this.views) throw new RuntimeError("not-found");
    return this.views.file(slot, key, path);
  }
  /** Answer a question an extension asked through Pi's `ctx.ui`. */
  answer(dialogId: string, answer: string | boolean | null): void {
    this.loaded();
    this.touch();
    if (!this.ui) throw new RuntimeError("not-found");
    this.ui.answer(dialogId, answer);
  }

  // ---- Loading --------------------------------------------------------------------------------

  /** Starts Pi's session for the chat, bounded by the operation timeout; setup keeps ownership until it really ends. */
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
    const cwd = await resolveFolder(metadata.cwd);
    let setup: Setup;
    try {
      setup = host.setup(metadata);
    } catch {
      throw new RuntimeError("persona");
    }
    const { managed, fixed } = await host.model(metadata, setup);
    metadata.model = managed ? managed.choice : { provider: fixed!.provider.id, id: fixed!.id };
    metadata.cwd = cwd;
    const dir = host.storage.prepare(metadata.id);
    const transcript = reopening ? host.storage.validateHistory(metadata) : undefined;
    metadata.interrupted ||= metadata.active;
    const manager = transcript ? SessionManager.open(transcript, dir, cwd) : SessionManager.create(cwd, dir, { id: metadata.id });
    metadata.active = true;
    metadata.setup = setup.fingerprint;
    if (reopening) host.storage.write(metadata);
    // Before extensions load: they may place components and raise notices while loading.
    const ui = (this.ui = new ExtensionUI({
      changed: () => this.changed(),
      position: () => this.session?.messages.length ?? 0,
      cwd,
      paused: () => this.pause(),
      resume: (go) => this.resume(go),
      save: (notice) => {
        if (!this.published || !this.session || this.closed) return false;
        this.session.sessionManager.appendCustomEntry(NOTICE_ENTRY, notice);
        this.changed();
        return true;
      },
    }));
    const views = (this.views = new ExtensionViews(
      setup.extensionPaths.map((path) => dirname(path)),
      { changed: () => this.changed(), failed: (message) => ui.failed(message), callTimeoutMs: host.callTimeout, places: host.places },
    ));
    const services = await createSessionServices({
      setup,
      cwd,
      agentDir: join(dir, "agent"),
      managed,
      fixed,
      admission: {
        valid: () => inputAdmission.getStore()?.valid() ?? true,
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
      host: { views },
    });
    const thinkingLevel = setup.settings.thinking ?? "off";
    let session: AgentSession;
    try {
      ({ session } = await createAgentSession({
        cwd,
        agentDir: join(dir, "agent"),
        model: services.model,
        modelRuntime: services.modelRuntime,
        settingsManager: services.settingsManager,
        resourceLoader: services.resourceLoader,
        sessionManager: manager,
        tools: services.activeTools,
        thinkingLevel,
        scopedModels: [{ model: services.model, thinkingLevel }],
        sessionStartEvent: { type: "session_start", reason: reopening ? "resume" : "new" },
      }));
    } catch (error) {
      services.resourceLoader.getExtensions().runtime.invalidate("Session creation failed");
      throw error;
    }
    this.session = session;
    if (session.model?.provider !== metadata.model.provider || session.model?.id !== metadata.model.id)
      throw new RuntimeError("configuration");
    if (this.error) throw new RuntimeError(this.error);
    this.unsubscribe = session.subscribe((event) => this.onEvent(event));
    const rendering = new ExtensionRendering(session, () => this.changed());
    this.items = new ItemProjector(session, rendering, (customType) => views.has(`custom:${customType}`));
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
        reload: unsupported,
      },
      abortHandler: () => void this.cancel().catch(() => {}),
      shutdownHandler: () => setImmediate(() => void this.stop().catch(() => {})),
      onError: (failure) => {
        this.extensionErrors++;
        // Once the chat is open, a failing handler is reported and the chat keeps working, as in Pi.
        if (this.published) ui.extensionFailed(extensionName(failure.extensionPath), failure.event, failure.error);
        else this.error = "extension";
        this.changed();
      },
    });
    if (this.error) throw new RuntimeError(this.error);
    if (this.closed) throw new RuntimeError("timeout");
    metadata.active = false;
    this.setupChanged = false;
    this.status = "idle";
    this.changed();
    host.storage.write(metadata);
    this.published = true;
    host.logger.event(reopening ? "session.recover" : "session.create", { sessionId: metadata.id, personaId: metadata.persona, outcome: "completed" });
    // A prompt that was waiting when PiSpark stopped rejoins the queue now that the chat is open.
    if (reopening && metadata.queued !== undefined) this.restoreQueued(metadata.queued);
    return this.doc();
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
    if (event.type === "agent_start" && this.run) this.run.admissionClosed = false;
    if (event.type === "agent_settled" && this.run) this.run.settled = true;
    // Pi's session name is the chat title: an extension's pi.setSessionName renames the chat.
    if (event.type === "session_info_changed" && event.name)
      try {
        this.setTitle(event.name);
      } catch (error) {
        // A closing chat or an invalid name keeps the current title; a failed save is said.
        if (error instanceof RuntimeError && error.code === "storage") this.ui?.failed("The chat title could not be saved.");
      }
    // A provider error is a failed run, unless the run was cancelled: then it is the cancel's result
    // (Pi records an error message for a run aborted before it reached the provider).
    if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error" && !this.run?.cancelled)
      this.error ??= "execution";
    this.changed();
  }

  private setTitle(input: string): void {
    if (
      !this.host.accepting() ||
      this.closed ||
      !this.host.holds(this) ||
      !this.session ||
      !["idle", "running"].includes(this.status) ||
      this.cancelling ||
      (this.status === "running" && this.run?.cancelled)
    )
      throw new RuntimeError("closed");
    const metadata = { ...this.metadata, title: toolChatTitle(input) };
    this.host.storage.write(metadata);
    this.metadata = metadata;
    this.changed();
  }
  /** An empty, never-started chat is named after its first message until the agent names it. */
  private firstTitle(metadata: ChatMetadata, text: string): void {
    if (!metadata.title && !this.host.storage.hasHistory(metadata.id) && !this.session!.messages.length)
      metadata.title = chatTitle(text) || "New chat";
  }

  // ---- Runs and the queue ---------------------------------------------------------------------

  /**
   * Sends a prompt: it runs now if a run slot is free, else it waits for one in order. A waiting
   * prompt is saved with the chat, so a restart keeps it.
   */
  start(text: string): RunHandle {
    validateText(text);
    if (!this.host.accepting()) throw new RuntimeError("closed");
    this.loaded();
    if (this.status !== "idle" || this.input) throw new RuntimeError("busy");
    this.touch();
    if (!this.host.slots.take(this.id)) return { completion: this.enqueue(text) };
    try {
      return { completion: this.begin(text) };
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
      // The prompt stays saved; it is offered again the next time the chat opens.
      this.host.slots.release(this.id);
    }
  }
  private enqueue(text: string, restored = false): Promise<RunResult> {
    const metadata = { ...this.metadata, queued: text };
    // A waiting first message already names the chat, so the list can tell queued chats apart.
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
          resolve(this.begin(text));
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
  /** Takes a queued prompt off the queue; a stopping chat keeps it saved for its next start. */
  private unqueue(keep: boolean): void {
    this.host.slots.withdraw(this.id);
    const resolve = this.queuedRun;
    this.queuedRun = undefined;
    if (!keep && this.metadata.queued !== undefined) {
      const { queued: _queued, ...metadata } = this.metadata;
      try {
        this.host.storage.write(metadata);
      } catch {
        /* The prompt stays saved; it is offered again when the chat opens. */
      }
      this.metadata = metadata;
    }
    if (this.status === "queued") this.status = "idle";
    this.restored = false;
    resolve?.({ outcome: "cancelled" });
    this.changed();
  }
  /** Runs a prompt; the chat holds a run slot. */
  private begin(text: string): Promise<RunResult> {
    const { host } = this;
    const session = this.loaded().session;
    const started = Date.now();
    const { queued: _queued, ...current } = this.metadata;
    const metadata = { ...current, active: true, interrupted: false };
    this.firstTitle(metadata, text);
    host.storage.write(metadata); // Before any model/tool side effects.
    this.metadata = metadata;
    this.status = "running";
    host.logger.event("session.start", { sessionId: this.id, outcome: "completed" });
    this.error = undefined;
    const run: Run = { cancelled: false, settled: false };
    this.run = run;
    this.changed();
    const timer = setTimeout(() => {
      this.error = "timeout";
      void this.cancel().catch(() => {});
    }, host.runTimeout);
    this.runDone = (async (): Promise<RunResult> => {
      try {
        // The persona's prompts work as /commands, as in terminal Pi. A cancel that arrives while Pi
        // prepares the run is caught where the provider would be called (beforeProviderDispatch).
        await session.prompt(text, { expandPromptTemplates: true, source: "rpc" });
        await session.waitForIdle();
        return this.error ? { outcome: "failed", error: this.error } : { outcome: run.cancelled ? "cancelled" : "completed" };
      } catch (error) {
        this.error = runtimeError(error, "execution").code;
        return { outcome: "failed", error: this.error };
      } finally {
        run.settled = true;
        clearTimeout(timer);
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
      }
    })().then((result) => (this.error ? { outcome: "failed", error: this.error } : result));
    return this.runDone;
  }
  /** Waiting for a person, the run gives its slot to the next chat. */
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
      const outcome = await (kind === "steer"
        ? session.steer(text, undefined, { source: "rpc" })
        : session.followUp(text, undefined, { source: "rpc" }));
      if (!valid()) throw new RuntimeError("busy");
      return outcome;
    });
    this.input = input;
    try {
      return await deadline(input, this.host.timeout);
    } catch (error) {
      if (error instanceof RuntimeError && error.code === "busy") throw error;
      this.error = runtimeError(error, "extension").code;
      void this.cancel().catch(() => {});
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
  async cancel(): Promise<void> {
    const { session } = this.loaded();
    if (this.loading) throw new RuntimeError("busy");
    // A prompt that has not started yet simply leaves the queue.
    if (this.status === "queued") return this.unqueue(false);
    if (!this.cancelling) {
      this.host.logger.event("session.cancel", { sessionId: this.id, outcome: "completed" });
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

  /** Stop the chat: end any run, let extensions shut down, release it. History stays. */
  stop(): Promise<void> {
    if (!this.stopping) {
      this.status = "stopping";
      if (this.run) this.run.cancelled = true;
      this.changed();
      this.stopping = this.dispose();
    }
    return deadline(this.stopping, this.host.timeout);
  }
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
    const session = this.session;
    if (session) {
      await this.drain(session);
      await this.runDone;
      await this.cancelling;
      const beforeShutdown = this.extensionErrors;
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
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
