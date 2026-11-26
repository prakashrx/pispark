import {
  type FSWatcher,
  cpSync,
  watch,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAtomic } from "../files.js";
import { SWITCH_PREFIX } from "../../contract/agent-protocol.js";
import type {
  ItemFile,
  ItemType,
  AgentResources,
  AvailableResource,
  ResourceReference,
  ResourceSource,
  AgentDefinition,
  AgentSummary,
  AgentTarget,
  ItemTarget,
} from "../../contract/agent-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import {
  DEFAULT_AGENT,
  DEFAULT_TOOLS,
  digest,
  fail,
  ITEM_TYPES,
  parseResource,
  itemPath,
  readablePath,
  AgentError,
  slug,
  validateDefinition,
  validAgentId,
  validItemName,
} from "./format.js";
import { inventory, readText, resource, skillFiles, type LayerItem } from "./resources.js";
export type { LayerItem } from "./resources.js";

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_FILE = 256 * 1024;

/** What a layer's agent.json may hold: Default and a session's own layer name no folder and no home view. */
const rules = (target: AgentTarget) => ({
  sessionLayer: "session" in target,
  binds: "agent" in target && target.agent !== DEFAULT_AGENT,
});
const isFolder = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Agent folders live in `<home>/agents/<id>/`; a session's own layer in `<home>/sessions/<id>/agent/`.
 * Plain files, no copies: sessions read agents live. Agents the app ships live in
 * `plugins/agents/<id>/`: listed like any agent, read-only, and replaced by an app update.
 */
export class AgentStore {
  private listeners = new Set<(target: AgentTarget) => void>();
  private readonly watchers: FSWatcher[] = [];
  private readonly sharedDir: string;
  private readonly pending = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly agentsDir: string,
    readonly sessionsDir: string,
    /** The agent a session started with; the base of its layer. */
    private readonly sessionAgent: (sessionId: string) => string,
    readonly logger: SafeLogger = silentLogger,
    private readonly bundledDir = fileURLToPath(new URL("../../../../../plugins/", import.meta.url)),
  ) {
    mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
    this.sharedDir = join(dirname(agentsDir), "resources");
    mkdirSync(this.sharedDir, { recursive: true, mode: 0o700 });
    this.ensureDefault();
    this.watch(agentsDir, (path) => path.split(/[\\/]/)[0]);
    this.watch(this.sharedDir, () => DEFAULT_AGENT);
  }

  /**
   * Edits made outside PiSpark (an extension's code or component, an instruction in an editor)
   * count as changes too, so open sessions can offer to reload. A burst is reported once.
   */
  private watch(directory: string, changedAgent: (path: string) => string | undefined): void {
    try {
      const watcher = watch(directory, { recursive: true }, (_event, file) => {
        const path = file ? String(file) : "";
        const id = changedAgent(path);
        if (!id || !validAgentId(id) || /\.tmp$/.test(path)) return;
        this.pending.add(id);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const ids = [...this.pending];
          this.pending.clear();
          for (const agent of ids) this.changed({ agent });
        }, 300);
      });
      watcher.on("error", () => watcher.close());
      watcher.unref();
      this.watchers.push(watcher);
    } catch {
      /* Without file watching, edits made in PiSpark are still noticed. */
    }
  }

  onChange(listener: (target: AgentTarget) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(target: AgentTarget): void {
    for (const listener of this.listeners) listener(target);
  }

  /** First start: a Default agent with Pi's built-in tools, so a new session has full access. */
  ensureDefault(): void {
    const dir = join(this.agentsDir, DEFAULT_AGENT);
    if (existsSync(join(dir, "agent.json"))) return;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const definition: AgentDefinition = {
      name: "Default",
      description: "The base of every agent.",
      on: DEFAULT_TOOLS.map((tool) => `tool:${tool}`),
      resources: {},
    };
    writeAtomic(
      join(dir, "agent.json"),
      JSON.stringify(definition, null, 2) + "\n",
    );
  }

  /** Whether the app ships this agent. Its ID is reserved: a data folder of the same name is ignored. */
  bundled(id: string): boolean {
    return validAgentId(id) && id !== DEFAULT_AGENT && existsSync(join(this.bundledDir, "agents", id, "agent.json"));
  }
  private writable(target: AgentTarget): void {
    if ("agent" in target && this.bundled(target.agent)) fail("built-in");
  }

  dir(target: AgentTarget): string {
    if ("agent" in target) {
      if (!validAgentId(target.agent)) fail("invalid-input");
      return this.bundled(target.agent) ? join(this.bundledDir, "agents", target.agent) : join(this.agentsDir, target.agent);
    }
    if (typeof target.session !== "string" || !UUID.test(target.session))
      fail("invalid-input");
    return join(this.sessionsDir, target.session, "agent");
  }
  /** Where an item's files live: a layer's folder, the Shared library, or the app's `plugins/`. */
  private fileRoot(target: ItemTarget): string {
    if ("library" in target) return target.library === "shared" ? this.sharedDir : this.bundledDir;
    return this.dir(target);
  }
  /** Whether the agent (or session layer) exists on disk. */
  exists(target: AgentTarget): boolean {
    return existsSync(join(this.dir(target), "agent.json"));
  }

  read(target: AgentTarget): {
    definition: AgentDefinition;
    revision: string;
  } {
    const path = join(this.dir(target), "agent.json");
    if (!existsSync(path)) {
      if ("session" in target) {
        // A session's layer builds on its agent; Default is always first and never listed.
        const agent = this.sessionAgent(target.session);
        return {
          definition: agent === DEFAULT_AGENT ? {} : { base: [agent] },
          revision: "",
        };
      }
      fail("not-found", 404);
    }
    const source = readText(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      return fail("invalid-definition", 400, "json");
    }
    return {
      definition: validateDefinition(parsed, rules(target)),
      revision: digest(source),
    };
  }

  list(): AgentSummary[] {
    const summaries: AgentSummary[] = [];
    const bundledDir = join(this.bundledDir, "agents");
    const bundled = isFolder(bundledDir) ? readdirSync(bundledDir).filter((id) => this.bundled(id)) : [];
    const own = readdirSync(this.agentsDir).filter((id) => validAgentId(id) && !bundled.includes(id) && existsSync(join(this.agentsDir, id, "agent.json")));
    for (const id of [...own, ...bundled]) {
      const shipped = bundled.includes(id) ? { bundled: true as const } : {};
      try {
        const { definition } = this.read({ agent: id });
        summaries.push({
          id,
          name: definition.name ?? id,
          ...(definition.description
            ? { description: definition.description }
            : {}),
          base: definition.base ?? [],
          builtIn: id === DEFAULT_AGENT,
          ...shipped,
          valid: true,
        });
      } catch (error) {
        summaries.push({
          id,
          name: id,
          base: [],
          builtIn: id === DEFAULT_AGENT,
          ...shipped,
          valid: false,
          error: error instanceof AgentError ? error.code : "storage",
        });
      }
    }
    return summaries.sort((a, b) =>
      a.builtIn !== b.builtIn
        ? a.builtIn
          ? -1
          : 1
        : a.name.localeCompare(b.name),
    );
  }

  create(input: {
    name: string;
    description?: string;
    base?: string[];
  }): { id: string; revision: string } {
    const definition = validateDefinition({
      name: input.name,
      resources: {},
      ...(input.description ? { description: input.description } : {}),
      ...(input.base?.length ? { base: input.base } : {}),
    });
    const id = slug(definition.name!, (candidate) =>
      existsSync(join(this.agentsDir, candidate)) || this.bundled(candidate),
    );
    for (const parent of definition.base ?? [])
      if (!this.exists({ agent: parent })) fail("missing-parent", 400, parent);
    const dir = join(this.agentsDir, id);
    mkdirSync(dir, { mode: 0o700 });
    const content = JSON.stringify(definition, null, 2) + "\n";
    writeAtomic(join(dir, "agent.json"), content);
    this.logger.event("agent.save", { agentId: id, outcome: "completed" });
    this.changed({ agent: id });
    return { id, revision: digest(content) };
  }

  /**
   * Replace agent.json if it still has `expectedRevision`. For a session with no layer yet,
   * `expectedRevision` is "" and the layer is created.
   */
  save(
    target: AgentTarget,
    expectedRevision: string,
    input: unknown,
    check?: (definition: AgentDefinition) => void,
  ): { revision: string } {
    this.writable(target);
    const definition = validateDefinition(input, rules(target));
    if ("agent" in target && definition.base?.includes(target.agent))
      fail("cycle", 400, target.agent);
    // Default is always the first layer; it has no parents.
    if (
      "agent" in target &&
      target.agent === DEFAULT_AGENT &&
      definition.base?.length
    )
      fail("invalid-definition", 400, "base");
    const current = this.exists(target) ? this.read(target) : undefined;
    if ((current?.revision ?? "") !== expectedRevision) fail("revision-conflict", 409);
    definition.resources ??= current ? current.definition.resources : {};
    // Checked when it is set. One that has since gone is found when a session starts there.
    if (definition.folder && definition.folder !== current?.definition.folder && !isFolder(definition.folder))
      fail("folder");
    check?.(definition);
    const dir = this.dir(target);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const content = JSON.stringify(definition, null, 2) + "\n";
    writeAtomic(join(dir, "agent.json"), content);
    this.logger.event("agent.save", {
      agentId: "agent" in target ? target.agent : "session",
      outcome: "completed",
    });
    this.changed(target);
    return { revision: digest(content) };
  }

  /** Turns a `type:name` switch on or off in an agent's own definition. */
  setSwitch(agent: string, name: string, on: boolean): void {
    const { definition, revision } = this.read({ agent });
    const without = (list?: string[]) => (list ?? []).filter((value) => value !== name);
    const next: AgentDefinition = { ...definition, on: [...without(definition.on), ...(on ? [name] : [])], off: [...without(definition.off), ...(on ? [] : [name])] };
    if (!next.on!.length) delete next.on;
    if (!next.off!.length) delete next.off;
    this.save({ agent }, revision, next);
  }

  remove(id: string): void {
    if (!validAgentId(id)) fail("invalid-input");
    if (id === DEFAULT_AGENT || this.bundled(id)) fail("built-in");
    if (!this.exists({ agent: id })) fail("not-found", 404);
    const dependent = this.list().find((p) => p.base.includes(id));
    if (dependent) fail("in-use", 409, dependent.id);
    rmSync(join(this.agentsDir, id), { recursive: true, force: true });
    this.changed({ agent: id });
  }

  /** An item file, or any file in a skill's folder, from a layer or a library. */
  readFile(target: ItemTarget, path: string): ItemFile {
    readablePath(path);
    const full = join(this.fileRoot(target), path);
    if (!existsSync(full)) fail("not-found", 404);
    const text = readText(full);
    return { text, revision: digest(text) };
  }

  /**
   * Create (expectedRevision null) or replace an instruction, prompt or SKILL.md. In a layer, a new
   * file is selected there. In the Shared library it reaches every agent that selects it; nothing
   * is selected. The app's own resources can't be written.
   */
  writeFile(
    target: ItemTarget,
    path: string,
    expectedRevision: string | null,
    text: string,
  ): ItemFile {
    const item = itemPath(path);
    if ("library" in target && target.library !== "shared") fail("built-in");
    if (!("library" in target)) this.writable(target);
    if (typeof text !== "string" || text.includes("\0")) fail("invalid-input");
    if (Buffer.byteLength(text) > MAX_FILE) fail("limit");
    if ("library" in target) {
      const full = join(this.sharedDir, path);
      const current = existsSync(full) ? digest(readText(full)) : null;
      if (current !== expectedRevision) fail("revision-conflict", 409);
      mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
      writeAtomic(full, text);
      this.changed({ agent: DEFAULT_AGENT });
      return { text, revision: digest(text) };
    }
    if (!this.exists(target)) {
      if ("agent" in target) fail("not-found", 404);
      this.save(target, "", this.read(target).definition);
    }
    const full = join(this.dir(target), path);
    const current = existsSync(full) ? digest(readText(full)) : null;
    if (current !== expectedRevision) fail("revision-conflict", 409);
    mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
    writeAtomic(full, text);
    const { definition, revision } = this.read(target);
    if (current === null && definition.resources) {
      try {
        this.select(target, item.type, `local:${item.name}`, true, revision);
      } catch (error) {
        unlinkSync(full);
        throw error;
      }
    } else this.changed(target);
    return { text, revision: digest(text) };
  }

  deleteFile(target: AgentTarget, path: string, expectedRevision: string) {
    const item = itemPath(path);
    this.writable(target);
    const full = join(this.dir(target), path);
    if (!existsSync(full)) fail("not-found", 404);
    if (digest(readText(full)) !== expectedRevision)
      fail("revision-conflict", 409);
    const { definition, revision } = this.read(target);
    if (definition.resources?.[item.type]?.includes(`local:${item.name}`))
      this.select(target, item.type, `local:${item.name}`, false, revision);
    // A skill is its whole folder (scripts, references).
    if (item.type === "skills")
      rmSync(dirname(full), { recursive: true, force: true });
    else unlinkSync(full);
    this.changed(target);
  }

  private root(target: AgentTarget, source: ResourceSource): string | undefined {
    if (source === "local") return this.dir(target);
    return source === "bundled" ? this.bundledDir : this.sharedDir;
  }

  private inlineMcp(definition: AgentDefinition, name: string): LayerItem | undefined {
    const servers = definition.mcpServers;
    return servers && Object.hasOwn(servers, name) ? { type: "mcp", name, config: servers[name] } : undefined;
  }

  private find(target: AgentTarget, definition: AgentDefinition, type: ItemType, reference: ResourceReference): LayerItem {
    const { source, name } = parseResource(reference)!;
    const root = this.root(target, source);
    const inline = source === "local" && type === "mcp" ? this.inlineMcp(definition, name) : undefined;
    const item = inline ?? (root && resource(root, type, name));
    if (!item) return { type, name, reference, unavailable: true };
    return { ...item, reference };
  }

  /** What a layer selects: only what its definition declares. */
  items(target: AgentTarget, definition: AgentDefinition): LayerItem[] {
    return ITEM_TYPES.flatMap((type) =>
      (definition.resources?.[type] ?? []).map((reference) => this.find(target, definition, type, reference)));
  }

  available(target: AgentTarget, type: ItemType): AvailableResource[] {
    const { definition } = this.read(target);
    return (["bundled", "shared", "local"] as const).flatMap((source) => {
      const root = this.root(target, source);
      const entries = root ? inventory(root, type) : [];
      const byName = new Map(entries.map((item) => [item.name, item]));
      if (source === "local" && type === "mcp")
        for (const name of Object.keys(definition.mcpServers ?? {}))
          byName.set(name, this.inlineMcp(definition, name)!);
      const used = source === "shared" ? this.usage() : undefined;
      return [...byName.values()].map(({ name, description }) => ({
        name,
        description,
        reference: `${source}:${name}` as ResourceReference,
        ...(used ? { usedBy: used.get(`${type}:${name}`) ?? 0 } : {}),
      }));
    });
  }

  /** A resolved skill's other files, relative to its folder, wherever it lives. */
  skillFiles(item: { name: string; reference?: ResourceReference; origin: { id: string } }, viewing: AgentTarget): string[] {
    const source = parseResource(item.reference ?? `local:${item.name}`)?.source ?? "local";
    const root = source === "local" ? this.dir(item.origin.id === "session" ? viewing : { agent: item.origin.id }) : this.fileRoot({ library: source });
    const found = resource(root, "skills", item.name);
    return found?.location ? skillFiles(found.location) : [];
  }

  /** How many agents select each shared resource, by `type:name`. */
  usage(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const { id } of this.list()) {
      let resources: AgentResources | undefined;
      try {
        resources = this.read({ agent: id }).definition.resources;
      } catch {
        continue;
      }
      for (const type of ITEM_TYPES)
        for (const reference of new Set(resources?.[type] ?? [])) {
          const parsed = parseResource(reference);
          if (parsed?.source === "shared") counts.set(`${type}:${parsed.name}`, (counts.get(`${type}:${parsed.name}`) ?? 0) + 1);
        }
    }
    return counts;
  }

  /**
   * Copy an item from where it lives (the Shared library, the app's resources, or another layer)
   * into this layer, whole: a skill or extension folder with all its files. The copy is selected
   * here under the same name, so it replaces the original for this layer only.
   */
  copyIn(target: AgentTarget, type: ItemType, name: string, from: ItemTarget, expectedRevision: string): { revision: string } {
    if (type === "mcp" || !validItemName(name)) return fail("invalid-input");
    this.writable(target);
    if (!("library" in from) && JSON.stringify(from) === JSON.stringify(target)) return fail("invalid-input");
    const item = resource(this.fileRoot(from), type, name);
    if (!item?.location) return fail("not-found", 404);
    const source = type === "extensions" && item.companions ? dirname(item.location) : item.location;
    const dir = this.dir(target);
    const destination = join(dir, type, basename(source));
    if (existsSync(destination) || resource(dir, type, name)) return fail("exists", 409, name);
    const { revision } = this.exists(target) ? this.read(target) : { revision: "" };
    if (revision !== expectedRevision) return fail("revision-conflict", 409);
    if (!this.exists(target)) this.save(target, "", this.read(target).definition);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    cpSync(source, destination, { recursive: true, filter: (path) => !/[\/]node_modules([\/]|$)/.test(path) });
    try {
      return this.select(target, type, `local:${name}`, true, this.read(target).revision);
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Move one of this agent's own items into the Shared library, so other agents can select it.
   * Its `local:` reference becomes `shared:`; agents built on this one keep it.
   */
  promote(target: AgentTarget, type: ItemType, name: string, expectedRevision: string): { revision: string } {
    if (!("agent" in target) || type === "mcp" || !validItemName(name)) return fail("invalid-input");
    this.writable(target);
    const { definition, revision } = this.read(target);
    if (revision !== expectedRevision) return fail("revision-conflict", 409);
    const selected = definition.resources?.[type] ?? [];
    if (!selected.includes(`local:${name}`)) return fail("not-found", 404);
    const item = resource(this.dir(target), type, name);
    if (!item?.location) return fail("not-found", 404);
    // A skill or a folder extension moves as its folder; the rest as their file.
    const from = type === "extensions" && item.companions ? dirname(item.location) : item.location;
    const to = join(this.sharedDir, type, basename(from));
    if (existsSync(to) || resource(this.sharedDir, type, name)) return fail("exists", 409, name);
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    renameSync(from, to);
    try {
      return this.save(target, revision, {
        ...definition,
        resources: { ...definition.resources, [type]: selected.map((reference) => (reference === `local:${name}` ? `shared:${name}` : reference)) },
      });
    } catch (error) {
      renameSync(to, from);
      throw error;
    }
  }

  select(target: AgentTarget, type: ItemType, reference: ResourceReference, on: boolean, expectedRevision: string) {
    const parsed = parseResource(reference);
    if (!parsed) return fail("invalid-input");
    const { definition, revision } = this.read(target);
    if (revision !== expectedRevision) return fail("revision-conflict", 409);
    const resources: AgentResources = structuredClone(definition.resources ?? {});
    const before = resources[type] ?? [];
    if (on) {
      if (this.find(target, definition, type, reference).unavailable) return fail("missing-resource", 404, reference);
      const next = before.filter((item) => parseResource(item)!.name !== parsed.name);
      resources[type] = [...next, reference];
      const key = SWITCH_PREFIX[type] + ":" + parsed.name;
      if (definition.off?.includes(key)) definition.off = definition.off.filter((item) => item !== key);
    } else resources[type] = before.filter((item) => item !== reference);
    if (!resources[type]?.length) delete resources[type];
    return this.save(target, revision, { ...definition, resources });
  }

  async shutdown(): Promise<void> {
    this.listeners.clear();
    clearTimeout(this.timer);
    for (const watcher of this.watchers) watcher.close();
  }
}
