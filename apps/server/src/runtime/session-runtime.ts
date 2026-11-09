import { TITLE_TOOL } from "../extensions/host-protocol.js";
import { chatTitle, toolChatTitle } from "./chat-title.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ItemsPage, LiveDoc, PartPage, SessionDoc } from "../protocol.js";
import { ItemProjector, progressOf } from "./items.js";
import { LiveView } from "./live-view.js";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  SessionContext,
} from "@earendil-works/pi-coding-agent";
import { createSessionServices, resolveFolder } from "./configuration.js";
import type { RuntimeConfiguration } from "./configuration.js";
import { deadline, RuntimeError, runtimeError, unsupported } from "./errors.js";
import type { RuntimeErrorCode } from "./errors.js";
import { ExtensionUI } from "../extensions/extension-ui.js";
import { ExtensionRendering } from "../extensions/extension-render.js";
import { ExtensionViews } from "../extensions/views.js";
import type { Json } from "../stream-ops.js";
import { SessionChanges } from "./observation.js";
import type { SessionChange } from "./observation.js";
import { ChatStorage, validateId } from "./storage.js";
import type { ChatMetadata } from "./storage.js";
import type { ProviderSettings } from "./provider-settings.js";
import type { ModelChoice } from "../provider-protocol.js";
import type { Provider } from "@earendil-works/pi-ai";
import { validChoice } from "./provider-storage.js";
import { PersonaStore } from "../personas/store.js";
import { resolveSetup, type Setup } from "../personas/resolve.js";
import { DEFAULT_PERSONA, validPersonaId } from "../personas/format.js";
import type { ChatPersona, PersonaTarget } from "../persona-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import { homePaths } from "../home.js";

export type SessionStatus =
  | "starting"
  | "idle"
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
}
export interface SessionSnapshot extends SessionSummary {
  sequence: number;
  model?: { provider: string; id: string };
  context: SessionContext;
  messages: AgentSession["messages"];
  partial?: AgentSession["state"]["streamingMessage"];
  queue: { steering: string[]; followUp: string[] };
  error?: RuntimeErrorCode;
}
export interface RunResult {
  outcome: "completed" | "cancelled" | "failed";
  error?: RuntimeErrorCode;
}
export interface RunHandle {
  completion: Promise<RunResult>;
}
interface RunIdentity {
  cancelled: boolean;
  settled: boolean;
  abortedBeforeDispatch?: boolean;
  admissionClosed?: boolean;
  input?: Promise<unknown>;
}
interface HostedSession {
  metadata: ChatMetadata;
  published: boolean;
  release: () => void;
  status: SessionStatus;
  sequence: number;
  observers: Set<SessionChanges>;
  session?: AgentSession;
  error?: RuntimeErrorCode;
  run?: Promise<RunResult>;
  identity?: RunIdentity;
  input?: Promise<unknown>;
  cancel?: Promise<void>;
  stop?: Promise<void>;
  unsubscribe?: () => void;
  disposeHost?: () => void;
  hostClosed?: boolean;
  loading?: Promise<SessionSnapshot>;
  extensionErrors: number;
  setupChanged?: boolean;
  /** What extensions show through Pi's `ctx.ui`, and their own renderers. */
  ui?: ExtensionUI;
  /** Components extensions placed in the chat's slots. */
  views?: ExtensionViews;
  rendering?: ExtensionRendering;
  /** Pi's session projected as chat items. */
  items?: ItemProjector;
  /** Running tool calls and what they reported last (Pi's partial result), by call id. References only. */
  running: Map<string, unknown>;
}

/** "extensions/notes.ts" and "extensions/notes/index.ts" are both "notes". */
function extensionName(path: string): string {
  const name = basename(path).replace(/\.[^.]+$/, "");
  return name === "index" ? basename(dirname(path)) : name;
}

/** Client-independent local owner. No HTTP, browser lifetime, terminal configuration or replay of interrupted tools. */
export class SessionRuntime {
  private readonly storage: ChatStorage;
  private readonly unwatchPersonas: () => void;
  readonly personas: PersonaStore;
  private readonly live = new Map<string, HostedSession>();
  private accepting = true;
  private readonly inputAdmission = new AsyncLocalStorage<{
    valid: () => boolean;
  }>();
  private readonly maxLive: number;
  private readonly timeout: number;
  private readonly runTimeout: number;
  constructor(
    private readonly configuration: RuntimeConfiguration,
    private readonly providers?: ProviderSettings,
    private readonly logger: SafeLogger = silentLogger,
  ) {
    this.maxLive = configuration.maxLiveSessions ?? 8;
    this.timeout = configuration.operationTimeoutMs ?? 10_000;
    this.runTimeout = configuration.runTimeoutMs ?? 300_000;
    if (
      ![this.maxLive, this.timeout, this.runTimeout].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    )
      throw new RuntimeError("configuration");
    const paths = homePaths(configuration.home);
    this.storage = new ChatStorage(paths.chats);
    this.personas = new PersonaStore(
      paths.personas,
      paths.chats,
      (chatId) => this.storage.read(chatId).persona,
      logger,
    );
    this.unwatchPersonas = this.personas.onChange(() => this.checkSetups());
  }

  list(): SessionSummary[] {
    const names = new Map(this.personas.list().map((p) => [p.id, p.name]));
    return this.storage
      .list()
      .map((metadata) =>
        this.summary(metadata, this.live.get(metadata.id), names),
      );
  }
  get unreadableSessions(): number {
    return this.storage.unreadable;
  }
  /** Recent distinct working folders, newest first, for Ask's folder picker. */
  recentFolders(limit = 8): string[] {
    const folders: string[] = [];
    for (const chat of this.storage
      .list()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      if (chat.cwd && !folders.includes(chat.cwd)) {
        folders.push(chat.cwd);
        if (folders.length >= limit) break;
      }
    return folders;
  }
  /** The chat's own layer once it has one, else the persona it started with. */
  private target(metadata: ChatMetadata): PersonaTarget {
    return this.personas.exists({ chat: metadata.id })
      ? { chat: metadata.id }
      : { persona: metadata.persona };
  }
  private personaName(id: string): string {
    try {
      return this.personas.read({ persona: id }).definition.name ?? id;
    } catch {
      return id;
    }
  }
  private summary(
    metadata: ChatMetadata,
    hosted?: HostedSession,
    names?: Map<string, string>,
  ): SessionSummary {
    return {
      id: metadata.id,
      folder: metadata.cwd,
      createdAt: metadata.createdAt,
      hasHistory: this.storage.hasHistory(metadata.id),
      ...(metadata.title ? { title: metadata.title } : {}),
      status: hosted?.status ?? "unloaded",
      interrupted: metadata.interrupted || (!hosted && metadata.active),
      persona: {
        id: metadata.persona,
        name: names?.get(metadata.persona) ?? this.personaName(metadata.persona),
        layered: this.personas.exists({ chat: metadata.id }),
      },
      ...(hosted?.setupChanged ? { personaChanged: true } : {}),
      ...(hosted?.ui?.asking ? { waiting: true } : {}),
    };
  }
  /** After any persona edit, flag open chats whose resolved setup no longer matches. */
  private checkSetups(): void {
    for (const hosted of this.live.values()) {
      if (!hosted.session || hosted.status === "stopping") continue;
      let fingerprint: string;
      try {
        fingerprint = resolveSetup(this.personas, this.target(hosted.metadata))
          .fingerprint;
      } catch {
        fingerprint = "";
      }
      const changed = fingerprint !== hosted.metadata.setup;
      if (changed !== !!hosted.setupChanged) {
        hosted.setupChanged = changed;
        this.changed(hosted);
      }
    }
  }
  private changed(hosted: HostedSession): void {
    hosted.sequence++;
    // No client callbacks, serialization, I/O or transcript copying in synchronous SDK listeners.
    for (const observer of hosted.observers)
      observer.push({
        sessionId: hosted.metadata.id,
        sequence: hosted.sequence,
        type: "changed",
      });
  }
  private get(id: string): HostedSession {
    validateId(id);
    const hosted = this.live.get(id);
    if (!hosted?.session) throw new RuntimeError("not-found");
    return hosted;
  }
  private admit(): void {
    if (!this.accepting) throw new RuntimeError("closed");
    if (this.live.size >= this.maxLive) throw new RuntimeError("limit");
  }
  /** A detached copy without provider error text, diagnostics or stacks. */
  private publicCopy<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (key, item: unknown) =>
        key === "errorMessage" || key === "diagnostics" || key === "stack" ? undefined : item,
      ),
    ) as T;
  }
  snapshot(id: string): SessionSnapshot {
    const hosted = this.get(id);
    const session = hosted.session!;
    return this.publicCopy(
      {
        ...this.summary(hosted.metadata, hosted),
        sequence: hosted.sequence,
        model: session.model
          ? { provider: session.model.provider, id: session.model.id }
          : undefined,
        context: session.sessionManager.buildSessionContext(),
        messages: session.messages,
        partial: session.state.streamingMessage,
        queue: {
          steering: [...session.getSteeringMessages()],
          followUp: [...session.getFollowUpMessages()],
        },
        error: hosted.error,
      },
    );
  }
  /** Everything about a chat except its history: status, model, queue and what extensions show. */
  session(id: string): SessionDoc {
    const hosted = this.get(id);
    const session = hosted.session!;
    return {
      ...this.summary(hosted.metadata, hosted),
      model: session.model
        ? { provider: session.model.provider, id: session.model.id }
        : undefined,
      queue: {
        steering: session.getSteeringMessages().length,
        followUp: session.getFollowUpMessages().length,
      },
      error: hosted.error,
      extensions: {
        ...(hosted.ui?.view() ?? { dialogs: [], statuses: [], widgets: [], notices: [] }),
        views: hosted.views?.view() ?? [],
      },
    };
  }
  private projector(id: string): ItemProjector {
    const items = this.get(id).items;
    if (!items) throw new RuntimeError("not-found");
    return items;
  }
  /** Finalized items on the chat's active branch, read straight from Pi's session. */
  items(id: string, options: { before?: string; after?: string; limit?: number }): ItemsPage {
    return this.projector(id).page(options);
  }
  image(id: string, itemId: string, part: number) {
    return this.projector(id).image(itemId, part);
  }
  text(id: string, itemId: string, part: number, offset: number): PartPage {
    return this.projector(id).text(itemId, part, offset);
  }
  /** A connection's live view of the chat, and the invalidations that say when to ask it for more. */
  observeLive(id: string): {
    view: LiveView;
    events: AsyncIterableIterator<SessionChange> & { close(): void };
  } {
    const hosted = this.get(id);
    if (hosted.observers.size >= 16) throw new RuntimeError("limit");
    const items = this.projector(id);
    const events = new SessionChanges(() => hosted.observers.delete(events));
    hosted.observers.add(events);
    try {
      const view = new LiveView(id, {
        doc: (): LiveDoc => ({ session: this.session(id), tail: items.tail(), progress: progressOf(hosted.running) }),
        head: () => items.head(),
        since: (after) => items.since(after),
      });
      return { view, events };
    } catch (error) {
      events.close();
      throw error;
    }
  }
  /** An extension component's `host.call`: a function of its own placement, and its result. */
  call(id: string, slot: string, key: string, name: string, data?: Json): Promise<Json | undefined> {
    const views = this.get(id).views;
    if (!views) throw new RuntimeError("not-found");
    return views.call(slot, key, name, data);
  }
  /** Answer a question an extension asked through Pi's `ctx.ui`. */
  answer(id: string, dialogId: string, answer: string | boolean | null): void {
    const ui = this.get(id).ui;
    if (!ui) throw new RuntimeError("not-found");
    ui.answer(dialogId, answer);
  }
  observe(id: string): {
    snapshot: SessionSnapshot;
    events: AsyncIterableIterator<SessionChange> & { close(): void };
  } {
    const hosted = this.get(id);
    if (hosted.observers.size >= 16) throw new RuntimeError("limit");
    const events = new SessionChanges(() => hosted.observers.delete(events));
    hosted.observers.add(events);
    try {
      return { snapshot: this.snapshot(id), events };
    } catch (error) {
      events.close();
      throw error;
    }
  }

  async create(request: {
    folder: string;
    model?: ModelChoice;
    persona?: string;
  }): Promise<SessionSnapshot> {
    this.admit();
    if (
      !request ||
      typeof request.folder !== "string" ||
      Object.keys(request).some(
        (key) => key !== "folder" && key !== "model" && key !== "persona",
      )
    )
      throw new RuntimeError("invalid-input");
    if (request.model !== undefined && !validChoice(request.model))
      throw new RuntimeError("invalid-input");
    const persona = request.persona ?? DEFAULT_PERSONA;
    if (!validPersonaId(persona)) throw new RuntimeError("invalid-input");
    if (!this.personas.exists({ persona })) throw new RuntimeError("persona");
    if (!isAbsolute(request.folder) || request.folder.length > 4096)
      throw new RuntimeError("invalid-input");
    // The folder is checked and made canonical during setup, after the slot is reserved.
    const metadata: ChatMetadata = {
      version: 2,
      id: randomUUID(),
      cwd: request.folder,
      persona,
      ...(request.model ? { model: request.model } : {}),
      createdAt: new Date().toISOString(),
      active: false,
      interrupted: false,
    };
    return this.load(metadata, false);
  }
  async open(id: string): Promise<SessionSnapshot> {
    validateId(id);
    if (this.live.has(id)) throw new RuntimeError("owned");
    this.admit();
    return this.load(this.storage.read(id), true);
  }
  /** Restart a chat's Pi session from its transcript, picking up persona changes. */
  async reload(id: string): Promise<SessionSnapshot> {
    validateId(id);
    const hosted = this.live.get(id);
    if (hosted) {
      if (
        hosted.loading ||
        (hosted.status !== "idle" && hosted.status !== "error")
      )
        throw new RuntimeError("busy");
      await this.stop(id);
    }
    return this.open(id);
  }
  private async chooseModel(
    metadata: ChatMetadata,
    setup: Setup,
  ): Promise<Awaited<ReturnType<ProviderSettings["select"]>>> {
    if (!this.providers) throw new RuntimeError("configuration");
    // A chat keeps its model. A new chat: Ask's choice, else the persona's, else the default.
    if (metadata.model) return this.providers.select(metadata.model);
    const preferred = setup.settings.model;
    const slash = preferred?.indexOf("/") ?? -1;
    if (preferred && slash > 0)
      try {
        return await this.providers.select({
          provider: preferred.slice(0, slash),
          id: preferred.slice(slash + 1),
        });
      } catch {
        /* Not signed in to it: fall back to the default model. */
      }
    return this.providers.select(undefined);
  }
  private async load(
    metadata: ChatMetadata,
    reopening: boolean,
  ): Promise<SessionSnapshot> {
    const hosted: HostedSession = {
      metadata,
      published: reopening,
      release: () => {},
      status: "starting",
      sequence: 0,
      observers: new Set(),
      running: new Map(),
      extensionErrors: 0,
    };
    this.live.set(metadata.id, hosted); // Reserve admission before any async setup.
    const initialize = async () => {
      const cwd = await resolveFolder(metadata.cwd);
      let setup: Setup;
      try {
        setup = resolveSetup(this.personas, this.target(metadata));
      } catch {
        throw new RuntimeError("persona");
      }
      let managed: Awaited<ReturnType<ProviderSettings["select"]>> | undefined;
      let fixed: { provider: Provider; id: string } | undefined;
      if (this.configuration.fixedModel) {
        const provider = this.configuration.fixedModel.provider();
        fixed = { provider, id: this.configuration.fixedModel.id };
        metadata.model = { provider: provider.id, id: fixed.id };
      } else {
        managed = await this.chooseModel(metadata, setup);
        metadata.model = managed.choice;
      }
      metadata.cwd = cwd;
      const dir = this.storage.prepare(metadata.id);
      const transcript = reopening
        ? this.storage.validateHistory(metadata)
        : undefined;
      metadata.interrupted ||= metadata.active;
      const manager = transcript
        ? SessionManager.open(transcript, dir, cwd)
        : SessionManager.create(cwd, dir, { id: metadata.id });
      metadata.active = true;
      metadata.setup = setup.fingerprint;
      if (reopening) this.storage.write(metadata);
      // Before extensions load: they may place components and raise notices while loading.
      hosted.ui = new ExtensionUI({
        changed: () => this.changed(hosted),
        position: () => hosted.session?.messages.length ?? 0,
        cwd,
      });
      hosted.views = new ExtensionViews(
        setup.extensionPaths.map((path) => dirname(path)),
        {
          changed: () => this.changed(hosted),
          failed: (message) => hosted.ui?.failed(message),
          callTimeoutMs: this.configuration.callTimeoutMs,
        },
      );
      const services = await createSessionServices({
        setup,
        cwd,
        agentDir: join(dir, "agent"),
        managed,
        fixed,
        admission: {
          valid: () => this.inputAdmission.getStore()?.valid() ?? true,
          beforeProviderDispatch: () => {
            if (hosted.identity?.cancelled || hosted.status === "stopping") {
              if (hosted.identity) hosted.identity.abortedBeforeDispatch = true;
              // Native ModelRuntime.lazyStream converts setup exceptions to a settled
              // event stream, including compaction requests before prompt "started".
              throw new DOMException(
                "The operation was aborted.",
                "AbortError",
              );
            }
          },
          beforeSettle: async () => {
            const identity = hosted.identity;
            if (!identity) return;
            // Close new admission across native settlement's async continuations.
            // Only preparation already owned by this run may finish here.
            identity.admissionClosed = true;
            await identity.input?.catch(() => {});
          },
        },
        host: {
          setTitle: (title, signal) => this.setTitle(hosted, title, signal),
          ownCleanup: (cleanup) => {
            hosted.disposeHost = cleanup;
          },
          views: hosted.views,
        },
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
          sessionStartEvent: {
            type: "session_start",
            reason: reopening ? "resume" : "new",
          },
        }));
      } catch (error) {
        services.resourceLoader
          .getExtensions()
          .runtime.invalidate("Session creation failed");
        throw error;
      }
      hosted.session = session;
      if (
        session.model?.provider !== metadata.model.provider ||
        session.model?.id !== metadata.model.id
      )
        throw new RuntimeError("configuration");
      if (hosted.error) throw new RuntimeError(hosted.error);
      hosted.unsubscribe = session.subscribe((event) => {
        // A running tool reports progress only as events. Keep the latest reference; it is
        // projected when a client asks, never here. Calls nested inside another tool are not shown.
        const tool = event as { type: string; toolCallId?: string; partialResult?: unknown; parentToolCallId?: string };
        if (tool.toolCallId && !tool.parentToolCallId) {
          if (tool.type === "tool_execution_start" || tool.type === "tool_execution_update")
            hosted.running.set(tool.toolCallId, tool.partialResult);
          else if (tool.type === "tool_execution_end") hosted.running.delete(tool.toolCallId);
        }
        if (event.type === "agent_settled") hosted.running.clear();
        if (event.type === "agent_start" && hosted.identity)
          hosted.identity.admissionClosed = false;
        if (event.type === "agent_settled" && hosted.identity)
          hosted.identity.settled = true;
        // Pi's session name is the chat title: an extension's pi.setSessionName renames the chat.
        if (event.type === "session_info_changed" && event.name)
          try {
            this.setTitle(hosted, event.name, new AbortController().signal);
          } catch {
            /* A closing chat or an invalid name keeps the current title. */
          }
        if (
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          event.message.stopReason === "error" &&
          !hosted.identity?.abortedBeforeDispatch
        )
          hosted.error ??= "execution";
        this.changed(hosted);
      });
      hosted.rendering = new ExtensionRendering(session, () => this.changed(hosted));
      const views = hosted.views;
      hosted.items = new ItemProjector(session, hosted.rendering, (customType) => views.has(`entry:${customType}`));
      // Pi's mode for clients that are not a terminal: dialogs and notices work, terminal components don't.
      await session.bindExtensions({
        mode: "rpc",
        uiContext: hosted.ui.context,
        commandContextActions: {
          waitForIdle: () => session.waitForIdle(),
          newSession: unsupported,
          fork: unsupported,
          navigateTree: unsupported,
          switchSession: unsupported,
          reload: unsupported,
        },
        abortHandler: () => {
          void this.cancel(metadata.id).catch(() => {});
        },
        shutdownHandler: () => {
          setImmediate(() => {
            void this.stop(metadata.id).catch(() => {});
          });
        },
        onError: (failure) => {
          hosted.extensionErrors++;
          // Once the chat is open, a failing handler is reported and the chat keeps working, as in Pi.
          if (hosted.published)
            hosted.ui?.extensionFailed(
              extensionName(failure.extensionPath),
              failure.event,
              failure.error,
            );
          else hosted.error = "extension";
          this.changed(hosted);
        },
      });
      if (hosted.error) throw new RuntimeError(hosted.error);
      if (hosted.hostClosed) throw new RuntimeError("timeout");
      metadata.active = false;
      hosted.setupChanged = false;
      hosted.status = "idle";
      this.changed(hosted);
      const snapshot = this.snapshot(metadata.id);
      this.storage.write(metadata);
      hosted.published = true;
      this.logger.event(reopening ? "session.recover" : "session.create", {
        sessionId: metadata.id,
        personaId: metadata.persona,
        outcome: "completed",
      });
      return snapshot;
    };
    const operation = initialize().catch(async (error: unknown) => {
      hosted.error = runtimeError(error, "configuration").code;
      this.logger.event("session.failure", {
        sessionId: metadata.id,
        outcome: "failed",
        code: hosted.error,
      });
      await this.disposeOwned(hosted);
      throw runtimeError(error, "configuration");
    });
    hosted.loading = operation;
    void operation
      .finally(() => {
        hosted.loading = undefined;
      })
      .catch(() => {});
    try {
      return await deadline(operation, this.timeout);
    } catch (error) {
      if (error instanceof RuntimeError && error.code === "timeout") {
        hosted.error = "timeout";
        hosted.hostClosed = true;
        hosted.status = "stopping";
        // Setup may still own extension work. Keep admission until it actually finishes.
        void operation
          .then(
            () => this.disposeOwned(hosted),
            () => {},
          )
          .catch(() => {});
      }
      throw runtimeError(error, "configuration");
    }
  }
  private setTitle(
    hosted: HostedSession,
    input: string,
    signal: AbortSignal,
  ): void {
    if (
      !this.accepting ||
      hosted.hostClosed ||
      this.live.get(hosted.metadata.id) !== hosted ||
      !hosted.session ||
      !["idle", "running"].includes(hosted.status) ||
      signal.aborted ||
      hosted.cancel ||
      (hosted.status === "running" && hosted.identity?.cancelled)
    )
      throw new RuntimeError("closed");
    const title = toolChatTitle(input);
    const metadata = { ...hosted.metadata, title };
    this.storage.write(metadata);
    hosted.metadata = metadata;
    this.changed(hosted);
  }
  private validateText(text: string): void {
    if (
      typeof text !== "string" ||
      !text.trim() ||
      Buffer.byteLength(text, "utf8") > 64 * 1024
    )
      throw new RuntimeError("invalid-input");
  }
  start(id: string, text: string): RunHandle {
    this.validateText(text);
    if (!this.accepting) throw new RuntimeError("closed");
    const hosted = this.get(id);
    if (hosted.status !== "idle" || hosted.input)
      throw new RuntimeError("busy");
    const started = Date.now();
    const metadata = { ...hosted.metadata, active: true, interrupted: false };
    if (
      !metadata.title &&
      !this.storage.hasHistory(id) &&
      !hosted.session!.messages.length
    )
      metadata.title = chatTitle(text) || "New chat";
    this.storage.write(metadata); // Before any model/tool side effects.
    hosted.metadata = metadata;
    hosted.status = "running";
    this.logger.event("session.start", { sessionId: id, outcome: "completed" });
    hosted.error = undefined;
    const identity: RunIdentity = { cancelled: false, settled: false };
    hosted.identity = identity;
    this.changed(hosted);
    const session = hosted.session!;
    const timer = setTimeout(() => {
      hosted.error = "timeout";
      void this.cancel(id).catch(() => {});
    }, this.runTimeout);
    hosted.run = (async (): Promise<RunResult> => {
      try {
        // Extension commands/templates are deliberately not a client-facing RPC seam.
        await session.prompt(text, {
          // The persona's prompts work as /commands, as in terminal Pi.
          expandPromptTemplates: true,
          source: "rpc",
          // Pinned Pi 1.5.0 INTERNAL typed callback: after native preflight resets
          // its abort flag, before agent_start (awaited before provider dispatch).
          preflightResult: (result) => {
            if (result === "started" && identity.cancelled) {
              identity.abortedBeforeDispatch = true;
              void session.abort().catch(() => {});
            }
          },
        });
        await session.waitForIdle();
        return hosted.error
          ? { outcome: "failed", error: hosted.error }
          : { outcome: identity.cancelled ? "cancelled" : "completed" };
      } catch (error) {
        hosted.error = runtimeError(error, "execution").code;
        return { outcome: "failed", error: hosted.error };
      } finally {
        identity.settled = true;
        identity.abortedBeforeDispatch = false;
        clearTimeout(timer);
        hosted.metadata.active = !!hosted.error;
        hosted.metadata.interrupted ||= !!hosted.error;
        try {
          this.storage.write(hosted.metadata);
        } catch {
          hosted.error = "storage";
          hosted.metadata.active = true;
        }
        if (hosted.status === "running")
          hosted.status = hosted.error ? "error" : "idle";
        this.logger.event("session.settle", {
          sessionId: id,
          durationMs: Date.now() - started,
          outcome: hosted.error
            ? "failed"
            : identity.cancelled
              ? "cancelled"
              : "completed",
          code: hosted.error,
        });
        this.changed(hosted);
      }
    })().then((result) =>
      hosted.error ? { outcome: "failed", error: hosted.error } : result,
    );
    return { completion: hosted.run };
  }
  async queue(
    id: string,
    text: string,
    kind: "steer" | "follow-up",
  ): Promise<"queued" | "handled"> {
    this.validateText(text);
    if (kind !== "steer" && kind !== "follow-up")
      throw new RuntimeError("invalid-input");
    const hosted = this.get(id);
    if (!this.accepting) throw new RuntimeError("closed");
    if (hosted.status !== "running" || hosted.input)
      throw new RuntimeError("busy");
    const session = hosted.session!;
    if (session.pendingMessageCount >= 8) throw new RuntimeError("limit");
    const identity = hosted.identity;
    if (
      !identity ||
      identity.settled ||
      identity.admissionClosed ||
      session.isIdle
    )
      throw new RuntimeError("busy");
    const valid = () =>
      hosted.identity === identity &&
      !identity.settled &&
      !identity.cancelled &&
      hosted.status === "running" &&
      !session.isIdle;
    const input = this.inputAdmission.run({ valid }, async () => {
      const outcome = await (kind === "steer"
        ? session.steer(text, undefined, { source: "rpc" })
        : session.followUp(text, undefined, { source: "rpc" }));
      if (!valid()) throw new RuntimeError("busy");
      return outcome;
    });
    hosted.input = input;
    identity.input = input;
    try {
      return await deadline(input, this.timeout);
    } catch (error) {
      if (error instanceof RuntimeError && error.code === "busy") throw error;
      hosted.error = runtimeError(error, "extension").code;
      void this.cancel(id).catch(() => {});
      throw runtimeError(error, "extension");
    } finally {
      void input
        .finally(() => {
          if (hosted.input === input) hosted.input = undefined;
          if (identity.input === input) identity.input = undefined;
          this.changed(hosted);
        })
        .catch(() => {});
    }
  }
  async cancel(id: string): Promise<void> {
    const hosted = this.get(id);
    if (hosted.loading) throw new RuntimeError("busy");
    if (!hosted.cancel) {
      this.logger.event("session.cancel", {
        sessionId: id,
        outcome: "completed",
      });
      if (hosted.identity) hosted.identity.cancelled = true;
      // Questions an extension is waiting on would hold the run open.
      hosted.ui?.dismissAll();
      if (hosted.status !== "stopping") hosted.status = "cancelling";
      this.changed(hosted);
      const session = hosted.session!;
      hosted.cancel = (async () => {
        session.clearQueue();
        await session.abort();
        await hosted.input?.catch(() => {});
        session.clearQueue();
        await session.abort();
        await hosted.run;
        if (hosted.status !== "stopping")
          hosted.status = hosted.error ? "error" : "idle";
        this.changed(hosted);
      })().finally(() => {
        hosted.cancel = undefined;
      });
    }
    try {
      await deadline(hosted.cancel, this.timeout);
    } catch (error) {
      hosted.error = runtimeError(error, "execution").code;
      this.changed(hosted);
      throw runtimeError(error, "execution");
    }
  }
  async stop(id: string): Promise<void> {
    validateId(id);
    const hosted = this.live.get(id);
    if (!hosted) throw new RuntimeError("not-found");
    if (hosted.loading) {
      await deadline(hosted.loading, this.timeout).catch((error: unknown) => {
        if (this.live.has(id)) throw error;
      });
      if (!this.live.has(id)) return;
    }
    if (!hosted.stop) {
      hosted.status = "stopping";
      if (hosted.identity) hosted.identity.cancelled = true;
      this.changed(hosted);
      hosted.stop = this.disposeOwned(hosted);
    }
    await deadline(hosted.stop, this.timeout);
  }
  private async disposeOwned(hosted: HostedSession): Promise<void> {
    hosted.status = "stopping";
    hosted.hostClosed = true;
    hosted.disposeHost?.();
    hosted.disposeHost = undefined;
    hosted.ui?.close();
    hosted.views?.close();
    let cleanupError: RuntimeErrorCode | undefined;
    const session = hosted.session;
    if (session) {
      session.clearQueue();
      await session.abort();
      await hosted.input?.catch(() => {});
      session.clearQueue();
      await session.abort();
      await hosted.run;
      await hosted.cancel;
      const beforeShutdown = hosted.extensionErrors;
      await session.extensionRunner.emit({
        type: "session_shutdown",
        reason: "quit",
      });
      if (hosted.extensionErrors !== beforeShutdown) cleanupError = "extension";
      await session.settingsManager.flush();
      if (session.settingsManager.drainErrors().length)
        cleanupError = "storage";
      hosted.unsubscribe?.();
      session.dispose();
      hosted.metadata.active = hosted.error === "storage";
      try {
        if (hosted.published) this.storage.write(hosted.metadata);
      } catch {
        cleanupError = "storage";
      }
    }
    if (cleanupError) hosted.error = cleanupError;
    hosted.status = "stopped";
    this.changed(hosted);
    for (const observer of hosted.observers) observer.close();
    hosted.release();
    this.live.delete(hosted.metadata.id);
    if (!hosted.published) this.storage.discardUnpublished(hosted.metadata.id);
    if (cleanupError) throw new RuntimeError(cleanupError);
  }
  async shutdown(): Promise<void> {
    this.accepting = false;
    this.unwatchPersonas();
    const results = await Promise.allSettled([
      this.personas.shutdown(),
      ...[...this.live.keys()].map((id) => this.stop(id)),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected")
      throw runtimeError(failed.reason, "execution");
  }
}

export type { RuntimeConfiguration } from "./configuration.js";
export { RuntimeError } from "./errors.js";
export type { SessionChange } from "./observation.js";
