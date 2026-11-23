import { readFile } from "node:fs/promises";
import {
  createCodemodeExtension,
  createToolSearchExtension,
  type EventBus,
  type Extension,
  type ExtensionFactory,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import type { ModelsStore } from "@earendil-works/pi-ai";
import { RuntimeError } from "./errors.js";

type ExplicitLoader = (
  paths: string[],
  cwd: string,
  bus: EventBus,
) => Promise<LoadExtensionsResult>;
type FactoryLoader = (
  factory: ExtensionFactory,
  cwd: string,
  bus: EventBus,
  runtime: LoadExtensionsResult["runtime"],
  path: string,
) => Promise<Extension>;

export function assertPiBoundary(
  version: unknown,
  loader: unknown,
): asserts loader is ExplicitLoader {
  if (version !== "1.5.2" || typeof loader !== "function")
    throw new RuntimeError("sdk-version");
}

// Both internal entry points are checked against the pinned SDK before use.
const packageEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
let metadata: Promise<{ version?: unknown }> | undefined;
async function pinnedVersion() {
  metadata ??= readFile(new URL("../package.json", packageEntry), "utf8").then(JSON.parse);
  return (await metadata).version;
}

/** Pi 1.5 couples its default disk store to loading a models.json. Keep those choices independent. */
export async function nativeCatalogStore(path: string): Promise<ModelsStore> {
  const module = await import(new URL("./core/models-store.js", packageEntry).href);
  if (await pinnedVersion() !== "1.5.2" || typeof module.FileModelsStore !== "function")
    throw new RuntimeError("sdk-version");
  return new module.FileModelsStore(path);
}

/**
 * Pi's built-in extensions that every session loads, as the CLI does. Their tools register
 * inactive and are switched on like any extension tool; an agent can switch them off. An extension
 * that registers the same tool replaces the built-in one, as in Pi. MCP comes with its own work.
 */
const PI_BUILT_INS: { name: string; factory: ExtensionFactory }[] = [
  { name: "codemode", factory: createCodemodeExtension() },
  { name: "tool-search", factory: createToolSearchExtension() },
];

/** Compatibility debt: 1.5.2 exports discovery, but not its explicit native loader. No discovery fallback. */
export async function loadExplicitExtensions(
  paths: string[],
  cwd: string,
  bus: EventBus,
): Promise<LoadExtensionsResult> {
  let loader: ExplicitLoader;
  let fromFactory: FactoryLoader;
  try {
    const module: { loadExtensions?: unknown; loadExtensionFromFactory?: unknown } = await import(
      new URL("./core/extensions/loader.js", packageEntry).href
    );
    assertPiBoundary(await pinnedVersion(), module.loadExtensions);
    if (typeof module.loadExtensionFromFactory !== "function") throw new RuntimeError("sdk-version");
    loader = module.loadExtensions;
    fromFactory = module.loadExtensionFromFactory as FactoryLoader;
  } catch {
    throw new RuntimeError("sdk-version");
  }
  let result: LoadExtensionsResult;
  try {
    result = await loader(paths, cwd, bus);
  } catch {
    throw new RuntimeError("resources");
  }
  for (const { name, factory } of PI_BUILT_INS) {
    const path = `builtin:${name}`;
    try {
      const extension = await fromFactory(factory, cwd, bus, result.runtime, path);
      extension.hidden = true;
      extension.replaceable = true;
      result.extensions.push(extension);
    } catch (error) {
      result.errors.push({ path, error: error instanceof Error ? error.message : "failed to load extension" });
    }
  }
  const taken = new Set(result.extensions.filter((e) => !e.replaceable).flatMap((e) => [...e.tools.keys()]));
  result.extensions = result.extensions.filter((e) => !e.replaceable || ![...e.tools.keys()].some((tool) => taken.has(tool)));
  return result;
}
