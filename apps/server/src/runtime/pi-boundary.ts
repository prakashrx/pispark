import { readFile } from "node:fs/promises";
import type {
  AgentSession,
  EventBus,
  ExtensionUIContext,
  LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { RuntimeError, unsupported } from "./errors.js";

type ExplicitLoader = (
  paths: string[],
  cwd: string,
  bus: EventBus,
) => Promise<LoadExtensionsResult>;

export function assertPiBoundary(
  version: unknown,
  loader: unknown,
): asserts loader is ExplicitLoader {
  if (version !== "1.4.0" || typeof loader !== "function")
    throw new RuntimeError("sdk-version");
}

/** Compatibility debt: 1.4.0 exports discovery, but not its explicit native loader. No discovery fallback. */
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

/** Pi's headless default silently accepts unsupported UI. Fail closed, without advertising a UI. */
export function bindHeadlessCapabilities(
  session: AgentSession,
): ExtensionUIContext {
  const runner = session.extensionRunner;
  if (
    typeof runner.hasUI !== "function" ||
    typeof runner.getUIContext !== "function"
  )
    throw new RuntimeError("sdk-version");
  // Instance only: never mutate Pi's shared noOpUIContext or ExtensionRunner.prototype.
  runner.hasUI = () => false;
  const theme = runner.getUIContext().theme;
  return {
    select: unsupported,
    confirm: unsupported,
    input: unsupported,
    custom: unsupported,
    editor: unsupported,
    notify: unsupported,
    onTerminalInput: unsupported,
    setStatus: unsupported,
    setWorkingMessage: unsupported,
    setWorkingVisible: unsupported,
    setWorkingIndicator: unsupported,
    setHiddenThinkingLabel: unsupported,
    setWidget: unsupported,
    setFooter: unsupported,
    setHeader: unsupported,
    setTitle: unsupported,
    pasteToEditor: unsupported,
    setEditorText: unsupported,
    getEditorText: () => "",
    addAutocompleteProvider: unsupported,
    setEditorComponent: unsupported,
    getEditorComponent: () => undefined,
    theme,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: unsupported,
    getToolsExpanded: () => false,
    setToolsExpanded: unsupported,
  };
}
