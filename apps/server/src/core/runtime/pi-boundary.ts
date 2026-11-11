import { readFile } from "node:fs/promises";
import type {
  EventBus,
  LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
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
  if (version !== "1.5.0" || typeof loader !== "function")
    throw new RuntimeError("sdk-version");
}

/** Compatibility debt: 1.5.0 exports discovery, but not its explicit native loader. No discovery fallback. */
export async function loadExplicitExtensions(
  paths: string[],
  cwd: string,
  bus: EventBus,
): Promise<LoadExtensionsResult> {
  let loader: ExplicitLoader;
  try {
    const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
    const metadata = JSON.parse(
      await readFile(new URL("../package.json", entry), "utf8"),
    ) as { version?: unknown };
    const module: { loadExtensions?: unknown } = await import(
      new URL("./core/extensions/loader.js", entry).href
    );
    assertPiBoundary(metadata.version, module.loadExtensions);
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
