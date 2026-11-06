import { realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { bindHost, TITLE_TOOL } from "../extensions/host-protocol.js";
import { isDeepStrictEqual } from "node:util";
import {
  createEventBus,
  loadSkills,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  PromptTemplate,
  InputEvent,
  ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type {
  CredentialStore,
  Provider,
  Model,
  Api,
} from "@earendil-works/pi-ai";
import { loadExplicitExtensions } from "./pi-boundary.js";
import { RuntimeError, unsupported } from "./errors.js";
import {
  nativeModelRuntime,
  requireHealthyModels,
  guardModelDispatch,
} from "./native-model-runtime.js";
import { ProviderError } from "./provider-errors.js";
import type { ProviderSettings } from "./provider-settings.js";
import type { AdmittedResources } from "../personas/admission.js";

/** Trusted server configuration, never a client command payload. Paths are exact local files, not discovery roots. */
export interface SessionConfiguration {
  modelId?: string;
  provider?: () => Provider;
  credential: { secretRef: string } | { local: true } | { stored: true };
  systemPrompt: string;
  tools: string[];
  extensions?: string[];
  instructions?: string[];
  skills?: string[];
  prompts?: PromptTemplate[];
}

export interface RuntimeConfiguration {
  storageDir: string;
  logging?: { directory?: string; console?: boolean };
  personas?: { directory: string; roots?: Record<string, string> };
  providerSettings?: {
    directory: string;
    modelsPath?: string | null;
    providers?: (() => Provider)[];
  };
  workspaces: Readonly<Record<string, string>>;
  configurations: Readonly<Record<string, SessionConfiguration>>;
  resolveSecret: (reference: string) => Promise<string | undefined>;
  maxLiveSessions?: number;
  operationTimeoutMs?: number;
  runTimeoutMs?: number;
}

export async function resolveWorkspace(
  path: string | undefined,
): Promise<string> {
  if (!path || !isAbsolute(path)) throw new RuntimeError("configuration");
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw new Error();
    return canonical;
  } catch {
    throw new RuntimeError("configuration");
  }
}

async function exactFiles(paths: string[] = []): Promise<string[]> {
  if (paths.length > 32) throw new RuntimeError("limit");
  try {
    return await Promise.all(
      paths.map(async (path) => {
        if (!isAbsolute(path)) throw new Error();
        const canonical = await realpath(path);
        if (!(await stat(canonical)).isFile()) throw new Error();
        return canonical;
      }),
    );
  } catch {
    throw new RuntimeError("resources");
  }
}

export async function createSessionServices(
  configuration: SessionConfiguration,
  cwd: string,
  agentDir: string,
  resolveSecret: RuntimeConfiguration["resolveSecret"],
  admission?: {
    valid: () => boolean;
    beforeSettle: () => Promise<void>;
    beforeProviderDispatch: () => void;
  },
  managed?: Awaited<ReturnType<ProviderSettings["select"]>>,
  persona?: AdmittedResources,
  host?: {
    setTitle: (title: string, signal: AbortSignal) => void;
    ownCleanup: (cleanup: () => void) => void;
  },
) {
  const secret =
    "secretRef" in configuration.credential
      ? await resolveSecret(configuration.credential.secretRef)
      : undefined;
  if ("secretRef" in configuration.credential && !secret)
    throw new RuntimeError("credentials");
  let modelRuntime;
  let provider: Provider | undefined;
  let selectedModel: Model<Api> | undefined;
  if (managed) {
    // Each session owns native configuration/auth composition, never the mutable catalog runtime.
    modelRuntime = await nativeModelRuntime(managed.runtimeOptions);
    for (const factory of managed.nativeProviders)
      modelRuntime.registerNativeProvider(factory());
    const result = await modelRuntime.refresh({ allowNetwork: false });
    requireHealthyModels(modelRuntime);
    if (result.aborted || result.errors.size)
      throw new ProviderError("provider-configuration");
    selectedModel = modelRuntime.getModel(
      managed.choice.provider,
      managed.choice.id,
    );
    // A changed file/catalog must be refreshed explicitly, not silently change the admitted model.
    if (!selectedModel || !isDeepStrictEqual(selectedModel, managed.model))
      throw new ProviderError("provider-configuration");
    if (
      !(await modelRuntime.getAvailable(managed.choice.provider)).some(
        (m) => m.id === managed.choice.id,
      )
    )
      throw new ProviderError("provider-unavailable");
    requireHealthyModels(modelRuntime);
    selectedModel = structuredClone(selectedModel);
    provider = modelRuntime.getProvider(managed.choice.provider);
  } else {
    provider = configuration.provider?.();
    if (provider)
      selectedModel = provider
        .getModels()
        .find(
          (model) =>
            model.id === configuration.modelId &&
            model.provider === provider?.id,
        );
  }
  if (!provider || !selectedModel) throw new RuntimeError("configuration");
  if ("local" in configuration.credential) {
    const endpoint = new URL(selectedModel.baseUrl);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      !["127.0.0.1", "[::1]"].includes(endpoint.hostname)
    )
      throw new RuntimeError("configuration");
  }
  // A non-secret local key prevents compatible transports from falling back to ambient keys.
  const requestKey = secret ?? "pispark-local-keyless";
  // Reject all other reads BEFORE Pi can fall back to environment, cloud or terminal credentials.
  const credentials: CredentialStore = {
    read: async (id) => {
      if (id !== provider.id) throw new RuntimeError("credentials");
      return { type: "api_key", key: requestKey };
    },
    list: async () => [{ providerId: provider.id, type: "api_key" }],
    modify: unsupported,
    delete: unsupported,
  };
  if (!modelRuntime) {
    modelRuntime = await nativeModelRuntime({ credentials, modelsPath: null });
    modelRuntime.registerNativeProvider({
      id: provider.id,
      name: provider.name,
      auth: {
        apiKey: {
          name: "PiSpark explicit credential",
          resolve: async () => ({ auth: { apiKey: requestKey } }),
        },
      },
      getModels: () => [selectedModel],
      stream: provider.stream.bind(provider),
      streamSimple: provider.streamSimple.bind(provider),
    });
  }
  requireHealthyModels(modelRuntime);
  if (admission)
    guardModelDispatch(modelRuntime, admission.beforeProviderDispatch);
  const settingsManager = SettingsManager.inMemory(
    {
      cacheWarming: "off",
      retry: { enabled: false },
      enableInstallTelemetry: false,
      defaultProvider: provider.id,
      defaultModel: selectedModel.id,
      enabledModels: [`${provider.id}/${selectedModel.id}`],
      defaultTools: [...new Set([...configuration.tools, TITLE_TOOL])],
    },
    { projectTrusted: false },
  );
  const [extensions, instructions, skills] = await Promise.all([
    exactFiles(configuration.extensions),
    persona ? [] : exactFiles(configuration.instructions),
    persona ? persona.skillPaths : exactFiles(configuration.skills),
  ]);
  const agentsFiles =
    persona?.agentsFiles ??
    (await Promise.all(
      instructions.map(async (path) => ({
        path,
        content: await readFile(path, "utf8"),
      })),
    ));
  const loadedSkills = loadSkills({
    cwd,
    agentDir,
    skillPaths: skills,
    includeDefaults: false,
  });
  if (loadedSkills.diagnostics.length) throw new RuntimeError("resources");
  const builtIn = await exactFiles([
    fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts")
          ? "../extensions/pispark.ts"
          : "../extensions/pispark.js",
        import.meta.url,
      ),
    ),
  ]);
  const eventBus = createEventBus();
  const cleanupHost = bindHost(
    eventBus,
    host?.setTitle ??
      (() => {
        throw new RuntimeError("closed");
      }),
  );
  host?.ownCleanup(cleanupHost);
  let loadedExtensions;
  try {
    loadedExtensions = await loadExplicitExtensions(
      [...builtIn, ...extensions],
      cwd,
      eventBus,
    );
    if (
      loadedExtensions.errors.length ||
      loadedExtensions.extensions
        .slice(1)
        .some((extension) => extension.tools.has(TITLE_TOOL))
    ) {
      loadedExtensions.runtime.invalidate("Resource loading failed");
      throw new RuntimeError("resources");
    }
  } catch (error) {
    cleanupHost();
    throw error;
  }
  // Last native input handler: user hooks run normally, but stale host queue admissions
  // must not append after their owning run settles. Extension-originated input is separate.
  if (admission) {
    const path = "<inline:pispark-input-admission>";
    loadedExtensions.extensions.push({
      path,
      resolvedPath: path,
      sourceInfo: {
        path,
        source: "inline",
        scope: "temporary",
        origin: "top-level",
      },
      handlers: new Map([
        [
          "input",
          [
            async (event: unknown) =>
              (event as InputEvent).source === "rpc" && !admission.valid()
                ? { action: "handled" }
                : { action: "continue" },
          ],
        ],
        ["agent_before_settle", [admission.beforeSettle]],
      ]),
      tools: new Map(),
      messageRenderers: new Map(),
      commands: new Map(),
      flags: new Map(),
      shortcuts: new Map(),
    });
  }
  const resourceLoader: ResourceLoader = {
    getExtensions: () => loadedExtensions,
    getSkills: () => loadedSkills,
    getPrompts: () => ({
      prompts: structuredClone(configuration.prompts ?? []),
      diagnostics: [],
    }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles }),
    getSystemPrompt: () => configuration.systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => persona?.instructions ?? [],
    getAppendSystemPromptSources: () => [],
    extendResources: unsupported,
    reload: unsupported,
  };
  return {
    modelRuntime,
    model: selectedModel,
    settingsManager,
    resourceLoader,
    eventBus,
    secret,
  };
}
