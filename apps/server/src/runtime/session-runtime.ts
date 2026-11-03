import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SessionWindow } from "../protocol.js";
import { messageWindow } from "./message-window.js";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  SessionContext,
} from "@earendil-works/pi-coding-agent";
import { createSessionServices, resolveWorkspace } from "./configuration.js";
import type { RuntimeConfiguration } from "./configuration.js";
import { deadline, RuntimeError, runtimeError, unsupported } from "./errors.js";
import type { RuntimeErrorCode } from "./errors.js";
import { bindHeadlessCapabilities } from "./pi-boundary.js";
import { SessionChanges } from "./observation.js";
import type { SessionChange } from "./observation.js";
import { SessionStorage, validateId } from "./storage.js";
import type { SessionMetadata } from "./storage.js";
import type { ProviderSettings } from "./provider-settings.js";
import type { ModelChoice } from "../provider-protocol.js";
import { validChoice } from "./provider-storage.js";

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
  workspace: string;
  configuration: string;
  createdAt: string;
  status: SessionStatus | "unloaded";
  interrupted: boolean;
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
  metadata: SessionMetadata;
  release: () => void;
  status: SessionStatus;
  sequence: number;
  observers: Set<SessionChanges>;
  session?: AgentSession;
  secret?: string;
  error?: RuntimeErrorCode;
  run?: Promise<RunResult>;
  identity?: RunIdentity;
  input?: Promise<unknown>;
  cancel?: Promise<void>;
  stop?: Promise<void>;
  unsubscribe?: () => void;
  loading?: Promise<SessionSnapshot>;
  extensionErrors: number;
}

/** Client-independent local owner. No HTTP, browser lifetime, terminal configuration or replay of interrupted tools. */
export class SessionRuntime {
  private readonly storage: SessionStorage;
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
    this.storage = new SessionStorage(configuration.storageDir);
  }

  list(): SessionSummary[] {
    return this.storage
      .list()
      .map((metadata) => this.summary(metadata, this.live.get(metadata.id)));
  }
  private summary(
    metadata: SessionMetadata,
    hosted?: HostedSession,
  ): SessionSummary {
    return {
      id: metadata.id,
      workspace: metadata.workspace,
      configuration: metadata.configuration,
      createdAt: metadata.createdAt,
      status: hosted?.status ?? "unloaded",
      interrupted: metadata.interrupted || (!hosted && metadata.active),
    };
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
  private publicCopy<T>(value: T, secret?: string): T {
    return JSON.parse(
      JSON.stringify(value, (key, item: unknown) => {
        if (key === "errorMessage" || key === "diagnostics" || key === "stack")
          return undefined;
        return typeof item === "string" && secret
          ? item.split(secret).join("[redacted]")
          : item;
      }),
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
      hosted.secret,
    );
  }
  /** Bounded native transcript window for clients; full canonical context remains Pi-owned. */
  window(id: string, before?: number): SessionWindow {
    const hosted = this.get(id);
    const session = hosted.session!;
    const messages = session.messages;
    const end =
      before === undefined
        ? messages.length
        : Math.min(before, messages.length);
    if (!Number.isSafeInteger(end) || end < 0)
      throw new RuntimeError("invalid-input");
    const start = Math.max(0, end - 20);
    const budget = { remaining: 24_000, truncated: false };
    const partial =
      before === undefined && session.state.streamingMessage
        ? messageWindow(session.state.streamingMessage, hosted.secret, budget)
        : undefined;
    const projected = messages
      .slice(start, end)
      .map((message) => messageWindow(message, hosted.secret, budget));
    return {
      ...this.summary(hosted.metadata, hosted),
      sequence: hosted.sequence,
      model: session.model
        ? { provider: session.model.provider, id: session.model.id }
        : undefined,
      messages: projected,
      partial,
      before: start,
      total: messages.length,
      truncated: budget.truncated,
      queue: {
        steering: session.getSteeringMessages().length,
        followUp: session.getFollowUpMessages().length,
      },
      error: hosted.error,
    };
  }
  observeWindow(id: string): {
    snapshot: SessionWindow;
    events: AsyncIterableIterator<SessionChange> & { close(): void };
  } {
    const hosted = this.get(id);
    if (hosted.observers.size >= 16) throw new RuntimeError("limit");
    const events = new SessionChanges(() => hosted.observers.delete(events));
    hosted.observers.add(events);
    try {
      return { snapshot: this.window(id), events };
    } catch (error) {
      events.close();
      throw error;
    }
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
    workspace: string;
    configuration: string;
    model?: ModelChoice;
  }): Promise<SessionSnapshot> {
    this.admit();
    if (
      !request ||
      typeof request.workspace !== "string" ||
      typeof request.configuration !== "string" ||
      Object.keys(request).some(
        (key) =>
          key !== "workspace" && key !== "configuration" && key !== "model",
      )
    )
      throw new RuntimeError("invalid-input");
    if (
      !Object.hasOwn(this.configuration.workspaces, request.workspace) ||
      !Object.hasOwn(this.configuration.configurations, request.configuration)
    )
      throw new RuntimeError("configuration");
    if (request.model !== undefined && !validChoice(request.model))
      throw new RuntimeError("invalid-input");
    const id = randomUUID();
    const metadata: SessionMetadata = {
      version: 1,
      id,
      workspace: request.workspace,
      configuration: request.configuration,
      model: request.model,
      cwd: "",
      createdAt: new Date().toISOString(),
      nativeFile: "",
      active: false,
      hasHistory: false,
      interrupted: false,
    };
    return this.load(metadata, false);
  }
  async open(id: string): Promise<SessionSnapshot> {
    this.admit();
    validateId(id);
    if (this.live.has(id)) throw new RuntimeError("owned");
    return this.load(this.storage.read(id), true);
  }
  private async load(
    metadata: SessionMetadata,
    reopening: boolean,
  ): Promise<SessionSnapshot> {
    const release = this.storage.claim(metadata.id);
    const hosted: HostedSession = {
      metadata,
      release,
      status: "starting",
      sequence: 0,
      observers: new Set(),
      extensionErrors: 0,
    };
    this.live.set(metadata.id, hosted); // Reserve admission before any async setup.
    const initialize = async () => {
      let configuration = Object.hasOwn(
        this.configuration.configurations,
        metadata.configuration,
      )
        ? this.configuration.configurations[metadata.configuration]
        : undefined;
      const cwd = await resolveWorkspace(
        Object.hasOwn(this.configuration.workspaces, metadata.workspace)
          ? this.configuration.workspaces[metadata.workspace]
          : undefined,
      );
      if (!configuration || (reopening && metadata.cwd !== cwd))
        throw new RuntimeError("configuration");
      let managed: Parameters<typeof createSessionServices>[5];
      if ("stored" in configuration.credential) {
        if (!this.providers || (reopening && !metadata.model))
          throw new RuntimeError("configuration");
        const selected = await this.providers.select(metadata.model);
        metadata.model = selected.choice;
        managed = selected;
      } else {
        const provider = configuration.provider?.();
        if (!provider || !configuration.modelId)
          throw new RuntimeError("configuration");
        if (
          metadata.model &&
          (metadata.model.provider !== provider.id ||
            metadata.model.id !== configuration.modelId)
        )
          throw new RuntimeError("configuration");
        metadata.model = { provider: provider.id, id: configuration.modelId };
        configuration = { ...configuration, provider: () => provider };
      }
      metadata.cwd = cwd;
      const dir = this.storage.directory(metadata.id);
      const persisted = reopening && this.storage.validateHistory(metadata);
      metadata.interrupted ||= metadata.active;
      const manager = persisted
        ? SessionManager.open(this.storage.nativePath(metadata), dir, cwd)
        : SessionManager.create(cwd, dir, { id: metadata.id });
      metadata.nativeFile = basename(manager.getSessionFile()!);
      metadata.active = true;
      this.storage.write(metadata);
      const services = await createSessionServices(
        configuration,
        cwd,
        join(dir, "agent"),
        this.configuration.resolveSecret,
        {
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
        managed,
      );
      hosted.secret = services.secret;
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
          tools: [...configuration.tools],
          thinkingLevel: "off",
          scopedModels: [{ model: services.model, thinkingLevel: "off" }],
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
        if (event.type === "agent_start" && hosted.identity)
          hosted.identity.admissionClosed = false;
        if (event.type === "agent_settled" && hosted.identity)
          hosted.identity.settled = true;
        if (
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          event.message.stopReason === "error" &&
          !hosted.identity?.abortedBeforeDispatch
        )
          hosted.error = "execution";
        this.changed(hosted);
      });
      await session.bindExtensions({
        mode: "json",
        uiContext: bindHeadlessCapabilities(session),
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
        onError: () => {
          hosted.extensionErrors++;
          hosted.error = "extension";
          this.changed(hosted);
        },
      });
      if (hosted.error) throw new RuntimeError(hosted.error);
      metadata.active = false;
      metadata.hasHistory = existsSync(this.storage.nativePath(metadata));
      this.storage.write(metadata);
      hosted.status = "idle";
      this.changed(hosted);
      return this.snapshot(metadata.id);
    };
    const operation = initialize().catch(async (error: unknown) => {
      hosted.error = runtimeError(error, "configuration").code;
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
        hosted.status = "stopping";
        // Setup may still own extension work. Retain admission/lock until it actually finishes.
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
    hosted.metadata.active = true;
    hosted.metadata.interrupted = false;
    this.storage.write(hosted.metadata); // Before any model/tool side effects.
    hosted.status = "running";
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
          expandPromptTemplates: false,
          source: "rpc",
          // Pinned Pi1.4.0 INTERNAL typed callback: after native preflight resets
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
        hosted.metadata.hasHistory = existsSync(
          this.storage.nativePath(hosted.metadata),
        );
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
      if (hosted.identity) hosted.identity.cancelled = true;
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
      hosted.metadata.hasHistory = existsSync(
        this.storage.nativePath(hosted.metadata),
      );
      hosted.metadata.active = hosted.error === "storage";
      try {
        this.storage.write(hosted.metadata);
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
    if (cleanupError) throw new RuntimeError(cleanupError);
  }
  async shutdown(): Promise<void> {
    this.accepting = false;
    const results = await Promise.allSettled(
      [...this.live.keys()].map((id) => this.stop(id)),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected")
      throw runtimeError(failed.reason, "execution");
  }
}

export type {
  RuntimeConfiguration,
  SessionConfiguration,
} from "./configuration.js";
export { RuntimeError } from "./errors.js";
export type { SessionChange } from "./observation.js";
