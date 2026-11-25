import { readdirSync, readFileSync, statSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  createEventBus,
  loadProjectContextFiles,
  loadSkills,
  parseFrontmatter,
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
import { compactionOverrides } from "./compaction.js";
import { loadExplicitExtensions } from "./pi-boundary.js";
import { RuntimeError, unsupported } from "./errors.js";
import {
  guardModelDispatch,
  nativeModelRuntime,
  requireHealthyModels,
} from "./native-model-runtime.js";
import { ProviderError } from "./provider-errors.js";
import type { ProviderSettings } from "./provider-settings.js";
import type { Setup } from "../agents/resolve.js";

/** PiSpark's built-in skills (`apps/server/skills/`), the same from source and from a build. */
export const BUILT_IN_SKILLS = ["pispark", "pispark-extensions"].map((name) =>
  fileURLToPath(new URL(`../../../skills/${name}`, import.meta.url)),
);

/** How a server is started. Only `home` is needed; the rest serve tests. */
export interface RuntimeConfiguration {
  /** Data root: sessions, agents, providers and logs live under it. */
  home: string;
  /** Optional catalog root override for isolated hosts and tests. */
  bundledResources?: string;
  logging?: { directory?: string; console?: boolean };
  providerSettings?: {
    modelsPath?: string | null;
    providers?: (() => Provider)[];
  };
  /** Tests only: one keyless loopback model instead of Providers & models. */
  fixedModel?: { provider: () => Provider; id: string };
  /** Loaded sessions above which idle ones unload early (default 32); never a refusal. */
  maxLiveSessions?: number;
  /** How long a session stays loaded while idle and not on screen (default 15 minutes). */
  idleUnloadMs?: number;
  /** How many sessions may run at once; more prompts wait for a turn (default 8). */
  maxRunning?: number;
  /**
   * The contribution points the client draws, besides the items of a session's history (the
   * workspace's are in `http/workspace-points.ts`). `item.tool:` and `item.custom:` need no entry.
   */
  points?: readonly string[];
  /** How long an extension component's call may take (default 30 s). */
  callTimeoutMs?: number;
  operationTimeoutMs?: number;
  /** How often schedules and waiting wakes are looked at (default a minute); 0 looks only when asked (tests). */
  wakeTickMs?: number;
  /** Tests only: the clock schedules and wakes go by. */
  now?: () => number;
}

/** PiSpark's own built-in extension (`extensions/pispark.ts`): loaded first in every session. */
export function builtInExtension(): string {
  return fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../extensions/pispark.ts" : "../extensions/pispark.js", import.meta.url));
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

/**
 * Prompt templates from paths an extension adds (Pi's `resources_discover`): a `.md` file, or a
 * folder's `.md` files (not recursive). Named, described and hinted as Pi names them.
 */
function discoveredPrompts(paths: string[]): PromptTemplate[] {
  const files = paths.flatMap((path) => {
    try {
      return statSync(path).isDirectory()
        ? readdirSync(path, { withFileTypes: true })
            .filter((entry) => entry.name.endsWith(".md") && statSync(join(path, entry.name)).isFile())
            .map((entry) => join(path, entry.name))
        : path.endsWith(".md") ? [path] : [];
    } catch {
      return [];
    }
  });
  return files.flatMap((filePath) => {
    try {
      const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(filePath, "utf8"));
      const firstLine = body.split("\n").find((line) => line.trim()) ?? "";
      const description =
        typeof frontmatter.description === "string" && frontmatter.description
          ? frontmatter.description
          : firstLine.length > 60 ? `${firstLine.slice(0, 60)}...` : firstLine;
      const argumentHint = frontmatter["argument-hint"];
      return [{
        name: basename(filePath).replace(/\.md$/, ""),
        description,
        ...(typeof argumentHint === "string" ? { argumentHint } : {}),
        content: body,
        filePath,
        sourceInfo: { path: filePath, source: "extension", scope: "temporary", origin: "top-level" },
      } as PromptTemplate];
    } catch {
      return [];
    }
  });
}

export async function createSessionServices(options: {
  setup: Setup;
  cwd: string;
  agentDir: string;
  managed?: Awaited<ReturnType<ProviderSettings["select"]>>;
  fixed?: { provider: Provider; id: string };
  admission: {
    valid: () => boolean;
    /** Before every agent run, whoever started it; the run starts when this resolves. */
    beforeRun: () => Promise<void>;
    beforeSettle: () => Promise<void>;
    beforeProviderDispatch: () => void;
  };
  host: {
    /** Pi's native model selection, including switches initiated by an extension. */
    modelSelected?: () => void;
    /** Extension components placed with `pispark:view` events on the session's bus. */
    views: { bind: (bus: EventBus) => () => void };
    /** The built-in schedule tool's requests, on the same bus. */
    schedules?: { bind: (bus: EventBus) => () => void };
    /** The built-in session tool's requests, on the same bus. */
    sessions?: { bind: (bus: EventBus) => () => void };
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
  // In memory, never terminal Pi's settings; project trust stays off. Pi's automatic retry of
  // transient provider failures and its cache warming stay on, with Pi's own limits.
  const settingsManager = SettingsManager.inMemory(
    {
      enableInstallTelemetry: false,
      defaultProvider: provider.id,
      defaultModel: selectedModel.id,
      enabledModels: [`${provider.id}/${selectedModel.id}`],
      defaultTools: setup.toolsOn,
      // Pi compacts; PiSpark keeps more of the recent conversation for models with larger windows.
      compaction: { modelOverrides: compactionOverrides(modelRuntime.getModels()) },
    },
    { projectTrusted: false },
  );
  // PiSpark's own skills come first: part of the system for every session, not an agent's items.
  // Paths an extension adds (Pi's `resources_discover`, at start and on reload) come last, so on a
  // name clash the agent's own skill wins, as in Pi.
  let skillPaths = [...BUILT_IN_SKILLS, ...setup.skillDirs];
  let loadedSkills = loadSkills({ cwd, agentDir, skillPaths, includeDefaults: false });
  const builtIn = builtInExtension();
  const eventBus = createEventBus();
  // Before any extension loads, so none of its placements are missed.
  const unbindViews = host.views.bind(eventBus);
  const unbindSchedules = host.schedules?.bind(eventBus);
  const unbindSessions = host.sessions?.bind(eventBus);
  let loadedExtensions;
  try {
    loadedExtensions = await loadExplicitExtensions(
      [builtIn, ...setup.extensionPaths],
      cwd,
      eventBus,
    );
    // PiSpark's own tools are reserved: an agent extension may not shadow them.
    const reserved = [...(loadedExtensions.extensions[0]?.tools.keys() ?? [])];
    if (
      loadedExtensions.errors.length ||
      loadedExtensions.extensions.slice(1).some((extension) => reserved.some((name) => extension.tools.has(name)))
    ) {
      loadedExtensions.runtime.invalidate("Resource loading failed");
      throw new RuntimeError("extension");
    }
  } catch (error) {
    unbindViews();
    unbindSchedules?.();
    unbindSessions?.();
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
      // Returns nothing, so the system prompt other handlers chained stays as it is.
      ["before_agent_start", [async () => void (await admission.beforeRun())]],
      ["agent_before_settle", [admission.beforeSettle]],
      ["model_select", [async () => host.modelSelected?.()]],
    ]),
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  });
  const ownPrompts = promptTemplates(setup);
  let prompts = ownPrompts;
  let promptPaths: string[] = [];
  const merge = (paths: string[], more: { path: string }[] | undefined) => [
    ...paths,
    ...(more ?? []).map((entry) => entry.path).filter((path) => !paths.includes(path)),
  ];
  /**
   * Pi's `resources_discover`: skills and prompts an extension adds to its session, read from disk
   * again on each call (at start and on reload), as Pi's own loader does.
   */
  const extendResources = (paths: Parameters<ResourceLoader["extendResources"]>[0]) => {
    if (paths.skillPaths?.length) {
      skillPaths = merge(skillPaths, paths.skillPaths);
      loadedSkills = loadSkills({ cwd, agentDir, skillPaths, includeDefaults: false });
    }
    if (paths.promptPaths?.length) {
      promptPaths = merge(promptPaths, paths.promptPaths);
      const names = new Set(ownPrompts.map((prompt) => prompt.name));
      prompts = [
        ...ownPrompts,
        ...discoveredPrompts(promptPaths).filter((prompt) => !names.has(prompt.name) && names.add(prompt.name)),
      ];
    }
  };
  // A project agent's session reads its folder's context files (AGENTS.md) the way Pi does. The
  // agent folder is the session's own, so terminal Pi's global file is never among them.
  const agentsFiles = setup.folder ? loadProjectContextFiles({ cwd, agentDir }) : [];
  const resourceLoader: ResourceLoader = {
    getExtensions: () => loadedExtensions,
    getSkills: () => loadedSkills,
    getPrompts: () => ({ prompts: structuredClone(prompts), diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles }),
    // Pi's own system prompt, with the agent's instructions appended.
    getSystemPrompt: () => undefined,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => setup.instructions.map((i) => i.text),
    getAppendSystemPromptSources: () => [],
    extendResources,
    reload: unsupported,
  };
  // The agent's tool switches, in Pi's own terms: tools switched off are excluded (never
  // registered, so no transcript can bring them back), and those switched on are `+name` modifiers
  // applied on top of the loadout a reopened transcript recorded. Not an allowlist, so a tool an
  // extension registers once the session runs is offered like any other.
  const off = new Set(setup.toolsOff);
  const extensionTools = loadedExtensions.extensions.flatMap((extension) => [
    ...extension.tools.keys(),
  ]);
  const toolSwitches = [...new Set([...setup.toolsOn, ...extensionTools])]
    .filter((name) => !off.has(name))
    .map((name) => `+${name}`);
  const excludedTools = [...off];
  return {
    modelRuntime,
    model: selectedModel,
    settingsManager,
    resourceLoader,
    eventBus,
    toolSwitches,
    excludedTools,
  };
}
