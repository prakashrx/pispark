import { basename, extname } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import type { DiscoveredTool } from "../../contract/persona-protocol.js";
import type { Setup } from "../personas/resolve.js";
import { builtInExtension } from "./configuration.js";
import { loadExplicitExtensions } from "./pi-boundary.js";

/** What loading a setup's extensions found: their tools, and whether any failed to load. */
export interface Discovered {
  tools: DiscoveredTool[];
  incomplete: boolean;
}

/** An extension's name as the persona lists it: its folder, or its file without the extension. */
const extensionName = (path: string) => {
  const file = basename(path);
  return /^index\.[cm]?[jt]s$/.test(file) ? basename(path.slice(0, -file.length - 1)) : basename(file, extname(file));
};

/**
 * The tools a persona's setup provides, found by running its extensions' factories without starting
 * a session (Pi allows it: "Extension factories may run in invocations that never start a session").
 * PiSpark's built-in extension comes first and counts as core. Kept per setup fingerprint, which
 * changes when the persona or its extension files change.
 */
export class ToolDiscovery {
  private readonly found = new Map<string, Promise<Discovered>>();
  /** Tools running sessions of a setup had that loading it without a session did not show, by fingerprint. */
  private readonly seen = new Map<string, Map<string, DiscoveredTool>>();

  constructor(private readonly cwd: string) {}

  /**
   * A running session of a setup has these tools (Pi's `getAllTools`). Those an extension registered
   * only once running, or MCP servers' tools, are remembered for the editor; Pi's own are listed anyway.
   */
  remember(fingerprint: string, extensionPaths: string[], tools: { name: string; description?: string; sourceInfo?: { path?: string } }[]): void {
    const names = new Map(extensionPaths.map((path) => [path, extensionName(path)]));
    const known = this.seen.get(fingerprint) ?? new Map<string, DiscoveredTool>();
    for (const tool of tools.slice(0, 500)) {
      const mcp = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(tool.name);
      const extension = tool.sourceInfo?.path ? names.get(tool.sourceInfo.path) : undefined;
      const source: DiscoveredTool["source"] | undefined = mcp ? { kind: "mcp", name: mcp[1]! } : extension ? { kind: "extension", name: extension } : undefined;
      if (source) known.set(tool.name, { name: tool.name, ...(tool.description ? { description: tool.description.slice(0, 1000) } : {}), source });
    }
    if (!known.size) return;
    if (!this.seen.has(fingerprint) && this.seen.size >= 64) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(fingerprint, known);
  }

  async tools(setup: Setup): Promise<Discovered> {
    const discovered = await this.discovered(setup);
    const extra = [...(this.seen.get(setup.fingerprint)?.values() ?? [])].filter((tool) => !discovered.tools.some((each) => each.name === tool.name));
    return extra.length ? { ...discovered, tools: [...discovered.tools, ...extra] } : discovered;
  }
  private discovered(setup: Setup): Promise<Discovered> {
    let found = this.found.get(setup.fingerprint);
    if (!found) {
      found = this.load(setup);
      // A bounded cache: fingerprints of old setups are dropped first.
      if (this.found.size >= 64) this.found.delete(this.found.keys().next().value!);
      this.found.set(setup.fingerprint, found);
      found.catch(() => this.found.delete(setup.fingerprint));
    }
    return found;
  }

  private async load(setup: Setup): Promise<Discovered> {
    const builtIn = builtInExtension();
    const loaded = await loadExplicitExtensions([builtIn, ...setup.extensionPaths], setup.folder ?? this.cwd, createEventBus());
    try {
      const tools = loaded.extensions.flatMap((extension) =>
        [...extension.tools.values()].map(({ definition }): DiscoveredTool => ({
          name: definition.name,
          ...(definition.label ? { label: definition.label } : {}),
          ...(definition.description ? { description: definition.description } : {}),
          source: extension.path === builtIn ? { kind: "core" } : { kind: "extension", name: extensionName(extension.path) },
        })),
      );
      return { tools, incomplete: loaded.errors.length > 0 };
    } finally {
      loaded.runtime.invalidate("Tool discovery finished");
    }
  }
}
