import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type {
  ItemType,
  LayerRef,
  PersonaDefinition,
  PersonaTarget,
  PersonaView,
  ResolvedItem,
  ResolvedTool,
} from "../persona-protocol.js";
import {
  BUILTIN_TOOLS,
  DEFAULT_PERSONA,
  digest,
  fail,
  frontmatter,
  parseSwitch,
  PersonaError,
} from "./format.js";
import type { LayerItem, PersonaStore } from "./store.js";

const MAX_LAYERS = 16;

interface Layer {
  ref: LayerRef;
  target: PersonaTarget;
  definition: PersonaDefinition;
  revision: string;
}
interface Entry {
  item: LayerItem;
  resolved: ResolvedItem;
}

/** What a Pi session receives. */
export interface Setup {
  layers: LayerRef[];
  items: ResolvedItem[];
  tools: ResolvedTool[];
  settings: PersonaDefinition["settings"] & {};
  instructions: { name: string; text: string }[];
  skillDirs: string[];
  prompts: {
    name: string;
    description: string;
    argumentHint?: string;
    content: string;
    filePath: string;
  }[];
  extensionPaths: string[];
  mcpServers: Record<string, Record<string, unknown>>;
  /** Built-in tools to enable, and any tool names switched off. */
  toolsOn: string[];
  toolsOff: string[];
  /** Hash of everything above that affects the agent. */
  fingerprint: string;
}

/**
 * Default → parents (flattened: each persona once, ancestors first, in listed order) → target.
 * Each layer adds its items (a same-name item replaces the earlier one), then applies its
 * `on` and `off` switches. Later layers win.
 */
export function resolveLayers(
  store: PersonaStore,
  target: PersonaTarget,
  override?: PersonaDefinition,
): Layer[] {
  const load = (layerTarget: PersonaTarget): Layer => {
    const viewing =
      JSON.stringify(layerTarget) === JSON.stringify(target) && override;
    if ("persona" in layerTarget && !store.exists(layerTarget))
      fail("missing-parent", 400, layerTarget.persona);
    const { definition, revision } = viewing
      ? { definition: override, revision: "" }
      : store.read(layerTarget);
    const id = "persona" in layerTarget ? layerTarget.persona : "chat";
    return {
      ref: {
        id,
        name: "chat" in layerTarget ? "This chat" : (definition.name ?? id),
      },
      target: layerTarget,
      definition,
      revision,
    };
  };
  const ordered: Layer[] = [];
  const done = new Set<string>([DEFAULT_PERSONA]);
  const visit = (layer: Layer, stack: string[]) => {
    for (const parent of layer.definition.base ?? []) {
      if (stack.includes(parent)) fail("cycle", 400, parent);
      if (done.has(parent)) continue;
      visit(load({ persona: parent }), [...stack, parent]);
    }
    const key = layer.ref.id;
    if (!done.has(key) || key === "chat") {
      done.add(key);
      ordered.push(layer);
    }
    if (ordered.length > MAX_LAYERS) fail("limit", 400, "layers");
  };
  const top = load(target);
  const isDefault = "persona" in target && target.persona === DEFAULT_PERSONA;
  const first = isDefault ? top : load({ persona: DEFAULT_PERSONA });
  if (!isDefault)
    visit(top, ["persona" in target ? target.persona : "chat"]);
  return [first, ...ordered];
}

const switchKey = (type: ItemType, name: string) => `${type}:${name}`;

function fold(store: PersonaStore, layers: Layer[]) {
  const entries = new Map<string, Entry>();
  const tools = new Map<string, ResolvedTool>();
  let settings: Setup["settings"] = {};
  for (const layer of layers) {
    for (const item of store.items(layer.target, layer.definition)) {
      const key = switchKey(item.type, item.name);
      const earlier = entries.get(key);
      entries.set(key, {
        item,
        resolved: {
          type: item.type,
          name: item.name,
          on: true,
          origin: layer.ref,
          replaced: earlier
            ? [...earlier.resolved.replaced, earlier.resolved.origin]
            : [],
          ...(item.description ? { description: item.description } : {}),
          ...(item.path ? { path: item.path } : {}),
        },
      });
    }
    for (const [list, on] of [
      [layer.definition.on ?? [], true],
      [layer.definition.off ?? [], false],
    ] as const)
      for (const value of list) {
        const parsed = parseSwitch(value)!;
        if (parsed.type === "tool") {
          tools.set(parsed.name, {
            name: parsed.name,
            on,
            builtIn: (BUILTIN_TOOLS as readonly string[]).includes(parsed.name),
            setBy: layer.ref,
          });
          continue;
        }
        const entry = entries.get(switchKey(parsed.type, parsed.name));
        // Switching an item no earlier layer provides does nothing; it may appear later.
        if (entry) {
          entry.resolved.on = on;
          entry.resolved.switchedBy = layer.ref;
        }
      }
    settings = { ...settings, ...layer.definition.settings };
  }
  for (const name of BUILTIN_TOOLS)
    if (!tools.has(name)) tools.set(name, { name, on: false, builtIn: true });
  return { entries, tools, settings };
}

/**
 * Cheap content identity for a skill or extension folder: its main file's text plus every file's
 * name, size and time, so editing a script, a helper or a component counts as a change.
 */
function treeIdentity(dir: string, main: string): string {
  const parts: string[] = [];
  const walk = (folder: string, depth: number) => {
    if (depth > 4 || parts.length > 256) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile()) {
        const stat = statSync(path);
        parts.push(`${relative(dir, path)}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  walk(dir, 0);
  return digest(readFileSync(main) + "\n" + parts.sort().join("\n"));
}
/** An extension folder (`extensions/<name>/index.ts`) is all of its files; a single-file extension is that file. */
const extensionIdentity = (location: string): string =>
  /^index\.(ts|js|mjs)$/.test(basename(location)) ? treeIdentity(dirname(location), location) : digest(readFileSync(location));

export function resolveSetup(
  store: PersonaStore,
  target: PersonaTarget,
): Setup {
  // A chat with no layer of its own simply uses its persona.
  const effective =
    "chat" in target && !store.exists(target)
      ? { persona: store.read(target).definition.base?.[0] ?? DEFAULT_PERSONA }
      : target;
  const layers = resolveLayers(store, effective);
  const { entries, tools, settings } = fold(store, layers);
  const active = [...entries.values()].filter((e) => e.resolved.on);
  const of = (type: ItemType) => active.filter((e) => e.item.type === type);
  const instructions = of("instructions").map((e) => ({
    name: e.item.name,
    text: readFileSync(e.item.location!, "utf8"),
  }));
  const prompts = of("prompts").map((e) => {
    const { data, body } = frontmatter(readFileSync(e.item.location!, "utf8"));
    return {
      name: e.item.name,
      description: e.resolved.description ?? "",
      ...(data["argument-hint"] ? { argumentHint: data["argument-hint"] } : {}),
      content: body,
      filePath: e.item.location!,
    };
  });
  const skillDirs = of("skills").map((e) => e.item.location!);
  const extensionPaths = of("extensions").map((e) => e.item.location!);
  const mcpServers = Object.fromEntries(
    of("mcp").map((e) => [e.item.name, e.item.config!]),
  );
  // Built-in tools in Pi's order, then extension tools by name.
  const order = (name: string) => {
    const index = (BUILTIN_TOOLS as readonly string[]).indexOf(name);
    return index < 0 ? BUILTIN_TOOLS.length : index;
  };
  const toolList = [...tools.values()].sort(
    (a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name),
  );
  const toolsOn = toolList.filter((t) => t.on && t.builtIn).map((t) => t.name);
  const toolsOff = toolList.filter((t) => !t.on).map((t) => t.name);
  const fingerprint = digest(
    JSON.stringify({
      instructions: instructions.map((i) => [i.name, digest(i.text)]),
      prompts: prompts.map((p) => [p.name, digest(p.content), p.description]),
      skills: of("skills").map((e) => [e.item.name, treeIdentity(e.item.location!, join(e.item.location!, "SKILL.md"))]),
      extensions: of("extensions").map((e) => [e.item.name, extensionIdentity(e.item.location!)]),
      mcpServers,
      toolsOn,
      toolsOff,
      settings,
    }),
  );
  return {
    layers: layers.map((l) => l.ref),
    items: [...entries.values()].map((e) => e.resolved),
    tools: toolList,
    settings,
    instructions,
    skillDirs,
    prompts,
    extensionPaths,
    mcpServers,
    toolsOn,
    toolsOff,
    fingerprint,
  };
}

/** The editor's view of one layer: its own definition plus everything it resolves to. */
export function viewPersona(
  store: PersonaStore,
  target: PersonaTarget,
): PersonaView {
  const { definition, revision } = store.read(target);
  try {
    const setup = resolveSetup(store, target);
    return {
      target,
      definition,
      revision,
      layers: setup.layers,
      items: setup.items,
      tools: setup.tools,
      settings: setup.settings,
    };
  } catch (error) {
    if (!(error instanceof PersonaError)) throw error;
    return {
      target,
      definition,
      revision,
      layers: [],
      items: [],
      tools: [],
      settings: {},
      error: error.code,
      ...(error.detail ? { detail: error.detail } : {}),
    };
  }
}

/** Throws if saving `definition` to `target` would leave it unresolvable through a cycle. */
export function checkCycles(
  store: PersonaStore,
  target: PersonaTarget,
  definition: PersonaDefinition,
): void {
  try {
    resolveLayers(store, target, definition);
  } catch (error) {
    // A missing parent is reported in the view, not refused: it may be created next.
    if (error instanceof PersonaError && error.code === "missing-parent") return;
    throw error;
  }
}
