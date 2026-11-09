import { randomUUID } from "node:crypto";
import {
  type FSWatcher,
  watch,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  ItemFile,
  ItemType,
  PersonaDefinition,
  PersonaSummary,
  PersonaTarget,
} from "../persona-protocol.js";
import { silentLogger, type SafeLogger } from "../logger.js";
import {
  DEFAULT_PERSONA,
  DEFAULT_TOOLS,
  digest,
  fail,
  frontmatter,
  itemPath,
  PersonaError,
  slug,
  validateDefinition,
  validItemName,
  validPersonaId,
} from "./format.js";

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_FILE = 256 * 1024;
const MAX_ITEMS = 64;

/** An item a layer's folder (or persona.json) provides. */
export interface LayerItem {
  type: ItemType;
  name: string;
  /** Absolute path: file for instructions/prompts/extensions, folder for skills. */
  location?: string;
  /** Relative path the UI can read and edit. */
  path?: string;
  description?: string;
  /** MCP server entry. */
  config?: Record<string, unknown>;
}

export function writeAtomic(path: string, content: string): void {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* The write error is what matters. */
    }
    throw error;
  }
}

const readText = (path: string): string => {
  if (lstatSync(path).isSymbolicLink()) fail("invalid-path");
  const buffer = readFileSync(path);
  if (buffer.length > MAX_FILE) fail("limit");
  return buffer.toString("utf8");
};

/**
 * Persona folders live in `<home>/personas/<id>/`; a chat's own layer in `<home>/chats/<id>/persona/`.
 * Plain files, no copies: chats read personas live.
 */
export class PersonaStore {
  private listeners = new Set<(target: PersonaTarget) => void>();
  private watcher?: FSWatcher;
  private readonly pending = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly personasDir: string,
    readonly chatsDir: string,
    /** The persona a chat started with; the base of its layer. */
    private readonly chatPersona: (chatId: string) => string,
    readonly logger: SafeLogger = silentLogger,
  ) {
    mkdirSync(personasDir, { recursive: true, mode: 0o700 });
    this.ensureDefault();
    this.watch();
  }

  /**
   * Edits made outside PiSpark (an extension's code or component, an instruction in an editor)
   * count as changes too, so open chats can offer to reload. A burst is reported once.
   */
  private watch(): void {
    try {
      this.watcher = watch(this.personasDir, { recursive: true }, (_event, file) => {
        const path = file ? String(file) : "";
        const id = path.split(/[\\/]/)[0];
        if (!id || !validPersonaId(id) || /\.tmp$/.test(path)) return;
        this.pending.add(id);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const ids = [...this.pending];
          this.pending.clear();
          for (const persona of ids) this.changed({ persona });
        }, 300);
      });
      this.watcher.on("error", () => this.watcher?.close());
      this.watcher.unref();
    } catch {
      /* Without file watching, edits made in PiSpark are still noticed. */
    }
  }

  onChange(listener: (target: PersonaTarget) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(target: PersonaTarget): void {
    for (const listener of this.listeners) listener(target);
  }

  /** First start: a Default persona with Pi's built-in tools, so a new chat has full access. */
  ensureDefault(): void {
    const dir = join(this.personasDir, DEFAULT_PERSONA);
    if (existsSync(join(dir, "persona.json"))) return;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const definition: PersonaDefinition = {
      name: "Default",
      description: "The base of every persona.",
      on: DEFAULT_TOOLS.map((tool) => `tool:${tool}`),
    };
    writeAtomic(
      join(dir, "persona.json"),
      JSON.stringify(definition, null, 2) + "\n",
    );
  }

  dir(target: PersonaTarget): string {
    if ("persona" in target) {
      if (!validPersonaId(target.persona)) fail("invalid-input");
      return join(this.personasDir, target.persona);
    }
    if (typeof target.chat !== "string" || !UUID.test(target.chat))
      fail("invalid-input");
    return join(this.chatsDir, target.chat, "persona");
  }
  /** Whether the persona (or chat layer) exists on disk. */
  exists(target: PersonaTarget): boolean {
    return existsSync(join(this.dir(target), "persona.json"));
  }

  read(target: PersonaTarget): {
    definition: PersonaDefinition;
    revision: string;
  } {
    const path = join(this.dir(target), "persona.json");
    if (!existsSync(path)) {
      if ("chat" in target) {
        // A chat's layer builds on its persona; Default is always first and never listed.
        const persona = this.chatPersona(target.chat);
        return {
          definition: persona === DEFAULT_PERSONA ? {} : { base: [persona] },
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
      definition: validateDefinition(parsed, { chatLayer: "chat" in target }),
      revision: digest(source),
    };
  }

  list(): PersonaSummary[] {
    const summaries: PersonaSummary[] = [];
    for (const id of readdirSync(this.personasDir)) {
      if (!validPersonaId(id)) continue;
      if (!existsSync(join(this.personasDir, id, "persona.json"))) continue;
      try {
        const { definition } = this.read({ persona: id });
        summaries.push({
          id,
          name: definition.name ?? id,
          ...(definition.description
            ? { description: definition.description }
            : {}),
          base: definition.base ?? [],
          builtIn: id === DEFAULT_PERSONA,
          valid: true,
        });
      } catch (error) {
        summaries.push({
          id,
          name: id,
          base: [],
          builtIn: id === DEFAULT_PERSONA,
          valid: false,
          error: error instanceof PersonaError ? error.code : "storage",
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
      ...(input.description ? { description: input.description } : {}),
      ...(input.base?.length ? { base: input.base } : {}),
    });
    const id = slug(definition.name!, (candidate) =>
      existsSync(join(this.personasDir, candidate)),
    );
    for (const parent of definition.base ?? [])
      if (!this.exists({ persona: parent })) fail("missing-parent", 400, parent);
    const dir = join(this.personasDir, id);
    mkdirSync(dir, { mode: 0o700 });
    const content = JSON.stringify(definition, null, 2) + "\n";
    writeAtomic(join(dir, "persona.json"), content);
    this.logger.event("persona.save", { personaId: id, outcome: "completed" });
    this.changed({ persona: id });
    return { id, revision: digest(content) };
  }

  /**
   * Replace persona.json if it still has `expectedRevision`. For a chat with no layer yet,
   * `expectedRevision` is "" and the layer is created.
   */
  save(
    target: PersonaTarget,
    expectedRevision: string,
    input: unknown,
    check?: (definition: PersonaDefinition) => void,
  ): { revision: string } {
    const definition = validateDefinition(input, {
      chatLayer: "chat" in target,
    });
    if ("persona" in target && definition.base?.includes(target.persona))
      fail("cycle", 400, target.persona);
    // Default is always the first layer; it has no parents.
    if (
      "persona" in target &&
      target.persona === DEFAULT_PERSONA &&
      definition.base?.length
    )
      fail("invalid-definition", 400, "base");
    const current = this.exists(target) ? this.read(target).revision : "";
    if (current !== expectedRevision) fail("revision-conflict", 409);
    check?.(definition);
    const dir = this.dir(target);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const content = JSON.stringify(definition, null, 2) + "\n";
    writeAtomic(join(dir, "persona.json"), content);
    this.logger.event("persona.save", {
      personaId: "persona" in target ? target.persona : "chat",
      outcome: "completed",
    });
    this.changed(target);
    return { revision: digest(content) };
  }

  remove(id: string): void {
    if (!validPersonaId(id)) fail("invalid-input");
    if (id === DEFAULT_PERSONA) fail("built-in");
    if (!this.exists({ persona: id })) fail("not-found", 404);
    const dependent = this.list().find((p) => p.base.includes(id));
    if (dependent) fail("in-use", 409, dependent.id);
    rmSync(join(this.personasDir, id), { recursive: true, force: true });
    this.changed({ persona: id });
  }

  readFile(target: PersonaTarget, path: string): ItemFile {
    itemPath(path);
    const full = join(this.dir(target), path);
    if (!existsSync(full)) fail("not-found", 404);
    const text = readText(full);
    return { text, revision: digest(text) };
  }

  /** Create (expectedRevision null) or replace an instruction, prompt or SKILL.md. */
  writeFile(
    target: PersonaTarget,
    path: string,
    expectedRevision: string | null,
    text: string,
  ): ItemFile {
    itemPath(path);
    if (typeof text !== "string" || text.includes("\0")) fail("invalid-input");
    if (Buffer.byteLength(text) > MAX_FILE) fail("limit");
    if (!this.exists(target)) {
      if ("persona" in target) fail("not-found", 404);
      this.save(target, "", this.read(target).definition);
    }
    const full = join(this.dir(target), path);
    const current = existsSync(full) ? digest(readText(full)) : null;
    if (current !== expectedRevision) fail("revision-conflict", 409);
    mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
    writeAtomic(full, text);
    this.changed(target);
    return { text, revision: digest(text) };
  }

  deleteFile(target: PersonaTarget, path: string, expectedRevision: string) {
    const item = itemPath(path);
    const full = join(this.dir(target), path);
    if (!existsSync(full)) fail("not-found", 404);
    if (digest(readText(full)) !== expectedRevision)
      fail("revision-conflict", 409);
    // A skill is its whole folder (scripts, references).
    if (item.type === "skills")
      rmSync(dirname(full), { recursive: true, force: true });
    else unlinkSync(full);
    this.changed(target);
  }

  /** Items a layer folder provides, plus its MCP servers. */
  items(target: PersonaTarget, definition: PersonaDefinition): LayerItem[] {
    const dir = this.dir(target);
    const found: LayerItem[] = [];
    const entries = (name: string) => {
      const folder = join(dir, name);
      if (!existsSync(folder) || lstatSync(folder).isSymbolicLink()) return [];
      return readdirSync(folder, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, MAX_ITEMS);
    };
    for (const type of ["instructions", "prompts"] as const)
      for (const entry of entries(type)) {
        const name = entry.name.replace(/\.md$/i, "");
        if (!entry.isFile() || name === entry.name || !validItemName(name))
          continue;
        const location = join(dir, type, entry.name);
        let description: string | undefined;
        if (type === "prompts") {
          const { data, body } = frontmatter(readText(location));
          description =
            data.description ||
            body.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 200);
        }
        found.push({
          type,
          name,
          location,
          path: `${type}/${entry.name}`,
          ...(description ? { description } : {}),
        });
      }
    for (const entry of entries("skills")) {
      const location = join(dir, "skills", entry.name);
      const skill = join(location, "SKILL.md");
      if (!entry.isDirectory() || !validItemName(entry.name) || !existsSync(skill))
        continue;
      const description = frontmatter(readText(skill)).data.description;
      found.push({
        type: "skills",
        name: entry.name,
        location,
        path: `skills/${entry.name}/SKILL.md`,
        ...(description ? { description: description.slice(0, 300) } : {}),
      });
    }
    for (const entry of entries("extensions")) {
      let name: string | undefined;
      let location: string | undefined;
      if (entry.isFile() && /\.(ts|js|mjs)$/.test(entry.name)) {
        name = entry.name.replace(/\.(ts|js|mjs)$/, "");
        location = join(dir, "extensions", entry.name);
      } else if (entry.isDirectory()) {
        const index = ["index.ts", "index.js", "index.mjs"]
          .map((file) => join(dir, "extensions", entry.name, file))
          .find((file) => existsSync(file));
        if (index) [name, location] = [entry.name, index];
      }
      if (name && location && validItemName(name))
        found.push({ type: "extensions", name, location });
    }
    for (const [name, config] of Object.entries(definition.mcpServers ?? {}))
      found.push({ type: "mcp", name, config });
    return found;
  }

  async shutdown(): Promise<void> {
    this.listeners.clear();
    clearTimeout(this.timer);
    this.watcher?.close();
  }
}
