import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { CredentialSynchronizationError } from "@earendil-works/pi-coding-agent";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import type {
  AuthView,
  AuthPromptView,
  AuthEventView,
} from "../provider-protocol.js";
import type { ProviderSettings } from "./provider-settings.js";
import { ProviderError } from "./provider-errors.js";

const abort = () => new DOMException("Sign-in cancelled", "AbortError");
function bounded(value: string, max = 2048) {
  if (typeof value !== "string" || value.length > max)
    throw new ProviderError("auth-limit");
  return value;
}
export function safeAuthUrl(value: string): string {
  const url = new URL(bounded(value, 4096));
  if (url.protocol !== "https:" || url.username || url.password)
    throw new ProviderError("provider-failed");
  return url.href;
}
function projectEvent(event: AuthEvent): AuthEventView {
  switch (event.type) {
    case "auth_url":
      return {
        type: event.type,
        url: safeAuthUrl(event.url),
        instructions: event.instructions
          ? bounded(event.instructions)
          : undefined,
      };
    case "device_code":
      return {
        type: event.type,
        userCode: bounded(event.userCode, 256),
        verificationUri: safeAuthUrl(event.verificationUri),
        expiresInSeconds: Number.isFinite(event.expiresInSeconds)
          ? Math.min(event.expiresInSeconds!, 600)
          : undefined,
      };
    case "info":
      return {
        type: event.type,
        message: bounded(event.message),
        links: event.links?.slice(0, 8).map((l) => ({
          url: safeAuthUrl(l.url),
          label: l.label ? bounded(l.label, 256) : undefined,
        })),
      };
    case "progress":
      return { type: event.type, message: bounded(event.message) };
  }
}
interface Transaction {
  owner: Buffer;
  view: AuthView;
  controller: AbortController;
  lease: number;
  deadline: number;
  settled?: number;
  pending?: {
    id: string;
    resolve: (value: string) => void;
    reject: () => void;
  };
  completion: Promise<void>;
  events: number;
}
/** Owner-only current state, not SSE/session replay. No submitted value is retained. */
export class ProviderAuth {
  private transactions = new Map<string, Transaction>();
  private timer: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(
    private readonly settings: ProviderSettings,
    private readonly limits = {
      lease: 30_000,
      deadline: 600_000,
      retention: 60_000,
      capacity: 8,
    },
  ) {
    this.timer = setInterval(() => this.sweep(), Math.min(1000, limits.lease));
    this.timer.unref();
  }
  private sweep() {
    const now = Date.now();
    for (const [id, t] of this.transactions) {
      if (t.settled !== undefined) {
        if (now - t.settled >= this.limits.retention)
          this.transactions.delete(id);
      } else if (now >= t.lease || now >= t.deadline) this.abort(t);
    }
  }
  private abort(t: Transaction) {
    t.controller.abort();
    t.pending?.reject();
    t.view.prompt = undefined;
    t.view.events = []; // Device codes/authorization URLs must not outlive the flow.
    // Keep provider lock/capacity until the native flow actually settles (cooperative cancellation).
  }
  private owner(id: string, token: string): Transaction {
    this.sweep();
    const t = this.transactions.get(id);
    const bytes = Buffer.from(typeof token === "string" ? token : "");
    if (
      !t ||
      bytes.length !== t.owner.length ||
      !timingSafeEqual(bytes, t.owner)
    )
      throw new ProviderError("auth-invalid");
    return t;
  }
  start(provider: string, method: "api_key" | "oauth") {
    this.sweep();
    if (this.closed || this.transactions.size >= this.limits.capacity)
      throw new ProviderError("auth-limit");
    this.settings.require(provider);
    const auth = this.settings.runtime.getProvider(provider)!.auth;
    if (
      (method !== "api_key" && method !== "oauth") ||
      !(method === "api_key" ? auth.apiKey?.login : auth.oauth?.login)
    )
      throw new ProviderError("auth-invalid");
    const release = this.settings.claim(provider);
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const t: Transaction = {
      owner: Buffer.from(token),
      view: { id, provider, method, state: "pending", events: [] },
      controller: new AbortController(),
      lease: Date.now() + this.limits.lease,
      deadline: Date.now() + this.limits.deadline,
      events: 0,
      completion: Promise.resolve(),
    };
    this.transactions.set(id, t);
    t.completion = (async () => {
      try {
        await this.settings.runtime.login(
          provider,
          method,
          {
            signal: t.controller.signal,
            prompt: (p) => this.prompt(t, p),
            notify: (event) => {
              t.controller.signal.throwIfAborted();
              if (++t.events > 64) {
                this.abort(t);
                throw new ProviderError("auth-limit");
              }
              t.view.events = [...t.view.events.slice(-7), projectEvent(event)];
            },
          },
          { agentName: "PiSpark", getDeviceId: () => this.settings.deviceId },
        );
        t.view.state = "saved";
      } catch (error) {
        t.view.state =
          error instanceof CredentialSynchronizationError
            ? "saved-sync-failed"
            : t.controller.signal.aborted
              ? "cancelled"
              : "failed";
      } finally {
        t.pending?.reject();
        t.view.prompt = undefined;
        t.view.events = [];
        t.settled = Date.now();
        release();
      }
    })();
    return { id, token };
  }
  private prompt(t: Transaction, p: AuthPrompt): Promise<string> {
    t.controller.signal.throwIfAborted();
    p.signal?.throwIfAborted();
    if (t.pending || ++t.events > 64) {
      this.abort(t);
      throw new ProviderError("auth-limit");
    }
    const id = randomUUID();
    const base = { id, message: bounded(p.message) };
    let view: AuthPromptView;
    if (p.type === "select") {
      if (
        !p.options.length ||
        p.options.some((o) => !o.id) ||
        p.options.length > 32 ||
        new Set(p.options.map((o) => o.id)).size !== p.options.length
      )
        throw new ProviderError("auth-limit");
      view = {
        ...base,
        type: p.type,
        options: p.options.map((o) => ({
          id: bounded(o.id, 256),
          label: bounded(o.label, 256),
          description: o.description ? bounded(o.description) : undefined,
        })),
      };
    } else
      view = {
        ...base,
        type: p.type,
        placeholder: p.placeholder ? bounded(p.placeholder, 256) : undefined,
      };
    t.view.prompt = view;
    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        t.controller.signal.removeEventListener("abort", cancelled);
        p.signal?.removeEventListener("abort", cancelled);
        if (t.pending?.id === id) {
          t.pending = undefined;
          t.view.prompt = undefined;
        }
      };
      const cancelled = () => {
        cleanup();
        reject(abort());
      };
      t.pending = {
        id,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: cancelled,
      };
      t.controller.signal.addEventListener("abort", cancelled, { once: true });
      p.signal?.addEventListener("abort", cancelled, { once: true });
      if (t.controller.signal.aborted || p.signal?.aborted) cancelled();
    });
  }
  observe(id: string, token: string): AuthView {
    const t = this.owner(id, token);
    if (!t.controller.signal.aborted) t.lease = Date.now() + this.limits.lease;
    return structuredClone(t.view);
  }
  respond(id: string, token: string, promptId: string, value: string) {
    const t = this.owner(id, token);
    const p = t.view.prompt;
    if (
      t.controller.signal.aborted ||
      !p ||
      !t.pending ||
      p.id !== promptId ||
      typeof value !== "string" ||
      Buffer.byteLength(value) > 8192 ||
      (p.type === "select" && !p.options.some((o) => o.id === value))
    )
      throw new ProviderError("auth-invalid");
    t.pending.resolve(value);
    // Do not put response text in receipts, retained state, logs or error objects.
  }
  cancel(id: string, token: string) {
    this.abort(this.owner(id, token));
  }
  async shutdown() {
    this.closed = true;
    clearInterval(this.timer);
    for (const t of this.transactions.values()) this.abort(t);
    await Promise.all([...this.transactions.values()].map((t) => t.completion));
    this.transactions.clear();
  }
}
