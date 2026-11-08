import { isAbsolute } from "node:path";
import {
  CredentialSynchronizationError,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type {
  ModelChoice,
  ProviderCatalog,
  ProviderInfo,
} from "../provider-protocol.js";
import type { RuntimeConfiguration } from "./configuration.js";
import type { Provider } from "@earendil-works/pi-ai";
import {
  nativeModelRuntime,
  requireHealthyModels,
  requireSupportedTransport,
} from "./native-model-runtime.js";
import { ModelDefaults, providerStores } from "./provider-storage.js";
import { ProviderError } from "./provider-errors.js";
import { RuntimeError } from "./errors.js";
import { homePaths } from "../home.js";

const text = (value: string, max = 256) => value.slice(0, max);
/** Separate settings ownership. Session instances share only the deliberate native locked credential store. */
export class ProviderSettings {
  private busy = new Set<string>();
  private writingDefault = false;
  private closed = false;
  private controller = new AbortController();
  private claims = new Set<Promise<void>>();
  private closing?: Promise<void>;
  private refreshFailed = false;
  private refreshing = false;
  constructor(
    readonly runtime: ModelRuntime,
    readonly authPath: string,
    readonly defaults: ModelDefaults,
    readonly allowed: (id: string) => boolean,
    private release: () => void,
    readonly networkBlocked: boolean,
    readonly deviceId: string,
    private readonly modelsPath: string | null = null,
    private readonly modelsStorePath?: string,
    private readonly nativeProviders: (() => Provider)[] = [],
  ) {}
  static async create(configuration: RuntimeConfiguration) {
    requireSupportedTransport();
    const root = homePaths(configuration.home).providers;
    if (!isAbsolute(root)) throw new ProviderError("provider-storage");
    // One server per data root is enforced by the home lock.
    const release = () => {};
    try {
      const stores = await providerStores(root);
      const defaults = new ModelDefaults(root);
      await defaults.load();
      const allowed = () => true;
      const runtime = await nativeModelRuntime({
        ...stores,
        modelsPath: configuration.providerSettings?.modelsPath ?? null,
      });
      for (const factory of configuration.providerSettings?.providers ?? [])
        runtime.registerNativeProvider(factory());
      const result = await runtime.refresh({
        allowNetwork: false,
        signal: AbortSignal.timeout(10_000),
      });
      requireHealthyModels(runtime);
      if (result.aborted || result.errors.size)
        throw new ProviderError("provider-configuration");
      return new ProviderSettings(
        runtime,
        stores.authPath,
        defaults,
        allowed,
        release,
        !allowed(),
        stores.deviceId,
        configuration.providerSettings?.modelsPath ?? null,
        stores.modelsStorePath,
        configuration.providerSettings?.providers,
      );
    } catch (error) {
      release();
      throw error instanceof ProviderError || error instanceof RuntimeError
        ? error
        : new ProviderError("provider-failed");
    }
  }
  require(id: string) {
    if (this.closed) throw new ProviderError("provider-busy");
    this.healthy();
    if (!this.runtime.getProvider(id))
      throw new ProviderError("provider-unavailable");
    if (!this.allowed(id)) throw new ProviderError("network-blocked");
  }
  claim(id: string): () => void {
    if (this.closed || this.busy.has(id) || this.busy.size >= 8)
      throw new ProviderError("provider-busy");
    this.busy.add(id);
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.claims.add(done);
    return () => {
      this.busy.delete(id);
      this.claims.delete(done);
      finish();
    };
  }
  private healthy() {
    if (this.closed || this.refreshing)
      throw new ProviderError("provider-busy");
    if (this.refreshFailed) throw new ProviderError("provider-configuration");
    requireHealthyModels(this.runtime);
  }
  private signal(milliseconds: number) {
    return AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(milliseconds),
    ]);
  }
  async catalog(): Promise<ProviderCatalog> {
    this.healthy();
    const stored = new Set(
      (await this.runtime.listCredentials({ signal: this.signal(5000) })).map(
        (c) => c.providerId,
      ),
    );
    const available = new Set(
      this.runtime
        .getAvailableSnapshot()
        .map((m) => JSON.stringify([m.provider, m.id])),
    );
    const providers: ProviderInfo[] = this.runtime
      .getProviders()
      .slice(0, 128)
      .map((p) => {
        const status = this.runtime.getProviderAuthStatus(p.id);
        return {
          id: text(p.id, 128),
          name: text(p.name),
          methods: [
            ...(p.auth.apiKey
              ? [
                  {
                    type: "api_key" as const,
                    label: text(p.auth.apiKey.name),
                    interactive: !!p.auth.apiKey.login,
                  },
                ]
              : []),
            ...(p.auth.oauth
              ? [
                  {
                    type: "oauth" as const,
                    label: text(p.auth.oauth.loginLabel ?? p.auth.oauth.name),
                    interactive: true,
                  },
                ]
              : []),
          ],
          configured: stored.has(p.id) || status.configured,
          stored: stored.has(p.id),
          source: stored.has(p.id)
            ? "stored"
            : status.configured
              ? "host"
              : "none",
          models: this.runtime
            .getModels(p.id)
            .slice(0, 4096)
            .map((m) => ({
              id: text(m.id),
              name: text(m.name),
              input: m.input.filter((i) => i === "text" || i === "image"),
              reasoning: m.reasoning === true,
              contextWindow: Number.isFinite(m.contextWindow)
                ? m.contextWindow
                : 0,
              available:
                this.allowed(p.id) &&
                available.has(JSON.stringify([p.id, m.id])),
            })),
        };
      });
    return {
      providers,
      defaultModel: this.defaults.value,
      networkBlocked: this.networkBlocked,
    };
  }
  async select(choice: ModelChoice | null | undefined) {
    const selected = choice ?? this.defaults.value;
    if (!selected) throw new ProviderError("provider-unavailable");
    this.require(selected.provider);
    const model = this.runtime.getModel(selected.provider, selected.id);
    if (
      !model ||
      !(
        await this.runtime.getAvailable(selected.provider, {
          signal: this.signal(10_000),
        })
      ).some((m) => m.id === selected.id)
    )
      throw new ProviderError("provider-unavailable");
    this.healthy();
    return {
      choice: { ...selected },
      model: structuredClone(model),
      runtimeOptions: {
        authPath: this.authPath,
        modelsPath: this.modelsPath,
        modelsStorePath: this.modelsStorePath,
      },
      nativeProviders: this.nativeProviders,
    };
  }
  async setDefault(choice: ModelChoice | null) {
    if (this.writingDefault || this.closed)
      throw new ProviderError("provider-busy");
    const finishDefault = this.claim("<default>");
    this.writingDefault = true;
    let release: (() => void) | undefined;
    try {
      if (choice) {
        release = this.claim(choice.provider);
        await this.select(choice);
      }
      await this.defaults.save(choice);
    } finally {
      release?.();
      this.writingDefault = false;
      finishDefault();
    }
  }
  async refresh(id: string) {
    // Refresh is also the recovery path after a failed configuration/catalog load.
    if (!this.runtime.getProvider(id))
      throw new ProviderError("provider-unavailable");
    if (!this.allowed(id)) throw new ProviderError("network-blocked");
    if (this.refreshing) throw new ProviderError("provider-busy");
    const release = this.claim(id);
    this.refreshing = true;
    this.refreshFailed = true;
    try {
      await nativeModelRuntime({
        authPath: this.authPath,
        modelsPath: this.modelsPath,
        modelsStorePath: this.modelsStorePath,
      });
      const result = await this.runtime.refresh({
        allowNetwork: true,
        providers: [id],
      });
      requireHealthyModels(this.runtime);
      if (result.aborted || result.errors.size)
        throw new ProviderError("provider-configuration");
      this.refreshFailed = false;
    } catch {
      throw new ProviderError("provider-configuration");
    } finally {
      this.refreshing = false;
      release();
    }
  }
  async logout(id: string) {
    if (!this.runtime.getProvider(id))
      throw new ProviderError("provider-unavailable");
    // Native removal changes only the stored credential, not ambient host configuration.
    const release = this.claim(id);
    try {
      await this.runtime.logout(id);
    } catch (error) {
      if (error instanceof CredentialSynchronizationError)
        throw new ProviderError("removed-sync-failed");
      throw error;
    } finally {
      release();
    }
  }
  stopAdmission() {
    this.closed = true;
    this.controller.abort();
  }
  close(): Promise<void> {
    this.stopAdmission();
    return (this.closing ??= (async () => {
      // Cooperative cancellation: keep ownership until native writes actually settle.
      await Promise.all(this.claims);
      this.release();
    })());
  }
}
