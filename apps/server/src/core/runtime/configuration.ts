import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { TITLE_TOOL } from "./chat-title.js";
import {
  createEventBus,
  loadSkills,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  EventBus,
  InputEvent,
  PromptTemplate,
  ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type {
  Api,
  CredentialStore,
  Model,
  Provider,
} from "@earendil-works/pi-ai";
import { loadExplicitExtensions } from "./pi-boundary.js";
import { RuntimeError, unsupported } from "./errors.js";
import {
  guardModelDispatch,
  nativeModelRuntime,
  requireHealthyModels,
} from "./native-model-runtime.js";
import { ProviderError } from "./provider-errors.js";
import type { ProviderSettings } from "./provider-settings.js";
import type { Setup } from "../personas/resolve.js";

/** How a server is started. Only `home` is needed; the rest serve tests. */
export interface RuntimeConfiguration {
  /** Data root: chats, personas, providers and logs live under it. */
  home: string;
  logging?: { directory?: string; console?: boolean };
  providerSettings?: {
    modelsPath?: string | null;
    providers?: (() => Provider)[];
  };
  /** Tests only: one keyless loopback model instead of Providers & models. */
  fixedModel?: { provider: () => Provider; id: string };
  /** Loaded chats above which idle ones unload early (default 32); never a refusal. */
  maxLiveSessions?: number;
  /** How long a chat stays loaded while idle and not on screen (default 15 minutes). */
  idleUnloadMs?: number;
  /** How many chats may run at once; more prompts wait for a turn (default 8). */
  maxRunning?: number;
  /**
   * The places where the client draws extension components (the workspace's are in
   * `http/workspace-places.ts`). Content slots (`tool:`, `custom:`) need no entry here.
   */
  places?: readonly string[];
  /** How long an extension component's call may take (default 30 s). */
  callTimeoutMs?: number;
  operationTimeoutMs?: number;
  runTimeoutMs?: number;
}

/** A working folder chosen in Ask: any existing folder on this host. */
export async function resolveFolder(path: unknown): Promise<string> {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 4096 ||
    !isAbsolute(path)
  )
    throw new RuntimeError("invalid-input");
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw new Error();
    return canonical;
  } catch {
    throw new RuntimeError("folder");
  }
}

function promptTemplates(setup: Setup): PromptTemplate[] {
  return setup.prompts.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    ...(prompt.argumentHint ? { argumentHint: prompt.argumentHint } : {}),
    content: prompt.content,
    filePath: prompt.filePath,
    sourceInfo: {
      path: prompt.filePath,
      source: "local",
      scope: "temporary",
      origin: "top-level",
    },
  })) as PromptTemplate[];
}

export async function createSessionServices(options: {
  setup: Setup;
  cwd: string;
  agentDir: string;
  managed?: Awaited<ReturnType<ProviderSettings["select"]>>;
  fixed?: { provider: Provider; id: string };
  admission: {
    valid: () => boolean;
    beforeSettle: () => Promise<void>;
    beforeProviderDispatch: () => void;
  };
  host: {
    /** Extension components placed with `pispark:view` events on the chat's bus. */
    views: { bind: (bus: EventBus) => () => void };
  };
}) {
  const { setup, cwd, agentDir, managed, fixed, admission, host } = options;
  let modelRuntime;
  let provider: Provider | undefined;
  let selectedModel: Model<Api> | undefined;
  if (managed) {
    // Each session composes its own native model runtime; it never shares the mutable catalog.
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
    // A changed catalog must be refreshed explicitly, not silently change the chosen model.
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
  } else if (fixed) {
    provider = fixed.provider;
    selectedModel = provider
      .getModels()
      .find((m) => m.id === fixed.id && m.provider === provider?.id);
    const endpoint = selectedModel && new URL(selectedModel.baseUrl);
    if (
      !endpoint ||
      !["http:", "https:"].includes(endpoint.protocol) ||
      !["127.0.0.1", "[::1]"].includes(endpoint.hostname)
    )
      throw new RuntimeError("configuration");
    const key = "pispark-local-keyless";
    // Refuse every other credential read so Pi never falls back to ambient keys.
    const credentials: CredentialStore = {
      read: async (id) => {
        if (id !== provider!.id) throw new RuntimeError("credentials");
        return { type: "api_key", key };
      },
      list: async () => [{ providerId: provider!.id, type: "api_key" }],
      modify: unsupported,
      delete: unsupported,
    };
    modelRuntime = await nativeModelRuntime({ credentials, modelsPath: null });
    const model = selectedModel;
    modelRuntime.registerNativeProvider({
      id: provider.id,
      name: provider.name,
      auth: {
        apiKey: {
          name: "PiSpark test credential",
          resolve: async () => ({ auth: { apiKey: key } }),
        },
      },
      getModels: () => [model!],
      stream: provider.stream.bind(provider),
      streamSimple: provider.streamSimple.bind(provider),
    });
  }
  if (!modelRuntime || !provider || !selectedModel)
    throw new RuntimeError("configuration");
  requireHealthyModels(modelRuntime);
  guardModelDispatch(modelRuntime, admission.beforeProviderDispatch);
  // In memory, never terminal Pi's settings; project trust stays off.
  const settingsManager = SettingsManager.inMemory(
    {
      cacheWarming: "off",
      retry: { enabled: false },
      enableInstallTelemetry: false,
      defaultProvider: provider.id,
      defaultModel: selectedModel.id,
      enabledModels: [`${provider.id}/${selectedModel.id}`],
      defaultTools: setup.toolsOn,
    },
    { projectTrusted: false },
  );
  const loadedSkills = loadSkills({
    cwd,
    agentDir,
    skillPaths: setup.skillDirs,
    includeDefaults: false,
  });
  const builtIn = fileURLToPath(
    new URL(
      import.meta.url.endsWith(".ts")
        ? "../extensions/pispark.ts"
        : "../extensions/pispark.js",
      import.meta.url,
    ),
  );
  const eventBus = createEventBus();
  // Before any extension loads, so none of its placements are missed.
  const unbindViews = host.views.bind(eventBus);
  let loadedExtensions;
  try {
    loadedExtensions = await loadExplicitExtensions(
      [builtIn, ...setup.extensionPaths],
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
      throw new RuntimeError("extension");
    }
  } catch (error) {
    unbindViews();
    throw error;
  }
  // Last input handler: queued input from a run that already settled must not be appended.
  const path = "<inline:pispark-input-admission>";
  loadedExtensions.extensions.push({
    path,
    resolvedPath: path,
    sourceInfo: { path, source: "inline", scope: "temporary", origin: "top-level" },
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
  const prompts = promptTemplates(setup);
  const resourceLoader: ResourceLoader = {
    getExtensions: () => loadedExtensions,
    getSkills: () => loadedSkills,
    getPrompts: () => ({ prompts: structuredClone(prompts), diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    // Pi's own system prompt, with the persona's instructions appended.
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => setup.instructions.map((i) => i.text),
    getAppendSystemPromptSources: () => [],
    extendResources: unsupported,
    reload: unsupported,
  };
  // The resolved setup decides the active tools, also on reopen, where Pi would otherwise
  // restore whatever the transcript last recorded.
  const off = new Set(setup.toolsOff.filter((name) => name !== TITLE_TOOL));
  const extensionTools = loadedExtensions.extensions.flatMap((extension) => [
    ...extension.tools.keys(),
  ]);
  const activeTools = [
    ...new Set([...setup.toolsOn, ...extensionTools]),
  ].filter((name) => !off.has(name));
  return {
    modelRuntime,
    model: selectedModel,
    settingsManager,
    resourceLoader,
    eventBus,
    activeTools,
  };
}
