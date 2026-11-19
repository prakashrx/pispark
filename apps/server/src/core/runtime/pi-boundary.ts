import { readFile } from "node:fs/promises";
import type {
  EventBus,
  LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import type { ModelsStore } from "@earendil-works/pi-ai";
import { RuntimeError } from "./errors.js";

type ExplicitLoader = (
  paths: string[],
  cwd: string,
  bus: EventBus,
) => Promise<LoadExtensionsResult>;

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

/** Compatibility debt: 1.5.2 exports discovery, but not its explicit native loader. No discovery fallback. */
export async function loadExplicitExtensions(
  paths: string[],
  cwd: string,
  bus: EventBus,
): Promise<LoadExtensionsResult> {
  let loader: ExplicitLoader;
  try {
    const module: { loadExtensions?: unknown } = await import(
      new URL("./core/extensions/loader.js", packageEntry).href
    );
    assertPiBoundary(await pinnedVersion(), module.loadExtensions);
    loader = module.loadExtensions;
  } catch {
    throw new RuntimeError("sdk-version");
  }
  try {
    return await loader(paths, cwd, bus);
  } catch {
    throw new RuntimeError("resources");
  }
}
