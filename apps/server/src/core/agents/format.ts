import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { DEFAULT_AGENT, ITEM_TYPES, SWITCH_PREFIX, THINKING_LEVELS } from "../../contract/agent-protocol.js";
import type { ItemType, ResourceSource, AgentDefinition, SwitchType, ThinkingLevel } from "../../contract/agent-protocol.js";
import { nextRun, parseCron } from "../../contract/cron.js";

export class AgentError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly detail?: string,
  ) {
    super(code);
  }
}
export const fail = (code: string, status = 400, detail?: string): never => {
  throw new AgentError(code, status, detail);
};

export { DEFAULT_AGENT };
/** Pi's built-in tools. The Default agent starts with all of them except powershell. */
export const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"] as const;
export const DEFAULT_TOOLS = BUILTIN_TOOLS.filter((t) => t !== "powershell");

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** The key an extension gives a view it offers. */
const VIEW_KEY = /^[\w.:-]{1,64}$/;
export const validItemName = (name: unknown): name is string => typeof name === "string" && NAME.test(name) && !name.endsWith(".");
export const validAgentId = (id: unknown): id is string => typeof id === "string" && ID.test(id);

/** "dev", "dev-2"… from a display name. */
export function slug(name: string, taken: (id: string) => boolean): string {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent";
  let id = base === DEFAULT_AGENT ? "default-2" : base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

/** `skill:review`, `instruction:tone`, `prompt:x`, `extension:x`, `mcp:x`, `tool:bash`, `routine:x` or `hold:x`. */
export function parseSwitch(value: unknown): { type: SwitchType; name: string } | undefined {
  if (typeof value !== "string") return undefined;
  const at = value.indexOf(":");
  const prefix = value.slice(0, at);
  const name = value.slice(at + 1);
  const type = (Object.keys(SWITCH_PREFIX) as SwitchType[]).find((key) => SWITCH_PREFIX[key] === prefix);
  if (at < 1 || !type || !validItemName(name)) return;
  return { type, name };
}

export function parseResource(value: unknown): { source: ResourceSource; name: string } | undefined {
  if (typeof value !== "string") return;
  const [source, name, extra] = value.split(":");
  if (extra !== undefined || !validItemName(name)) return;
  if (source === "bundled" || source === "shared" || source === "local") return { source, name };
}

const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const text = (value: unknown, max: number, required = false) => {
  if (value === undefined && !required) return;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    (required && !value) ||
    value.length > max ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(value)
  )
    fail("invalid-definition", 400, "text");
};

/** Strict, small and complete: unknown keys are refused so typos never silently do nothing. */
export function validateDefinition(
  value: unknown,
  {
    sessionLayer = false,
    // A folder and a home view: not for Default, which every agent builds on, nor for a session's
    // own layer, whose session already has both.
    binds = !sessionLayer,
  }: { sessionLayer?: boolean; binds?: boolean } = {},
): AgentDefinition {
  if (!plainObject(value)) return fail("invalid-definition", 400, "object");
  const allowed = [
    "name",
    "description",
    "base",
    "on",
    "off",
    "mcpServers",
    "resources",
    "settings",
    ...(binds ? ["folder", "home", "routines"] : []),
  ];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail("invalid-definition", 400, unknown);
  text(value.name, 120, !sessionLayer);
  text(value.description, 1024);
  text(value.folder, 4096);
  if (value.folder !== undefined && !isAbsolute(value.folder as string)) fail("invalid-definition", 400, "folder");
  if (value.home !== undefined && (typeof value.home !== "string" || !VIEW_KEY.test(value.home))) fail("invalid-definition", 400, "home");
  if (value.base !== undefined) {
    if (
      !Array.isArray(value.base) ||
      value.base.length > 8 ||
      new Set(value.base).size !== value.base.length ||
      value.base.some((id) => !validAgentId(id) || id === DEFAULT_AGENT)
    )
      fail("invalid-definition", 400, "base");
  }
  for (const key of ["on", "off"] as const)
    if (value[key] !== undefined) {
      const list = value[key];
      if (!Array.isArray(list) || list.length > 128 || new Set(list).size !== list.length || list.some((entry) => !parseSwitch(entry)))
        fail("invalid-definition", 400, key);
    }
  const on = new Set((value.on as string[] | undefined) ?? []);
  if (((value.off as string[] | undefined) ?? []).some((s) => on.has(s))) fail("invalid-definition", 400, "on-and-off");
  if (value.resources !== undefined) {
    if (!plainObject(value.resources)) return fail("invalid-definition", 400, "resources");
    for (const [type, references] of Object.entries(value.resources)) {
      if (!ITEM_TYPES.includes(type as ItemType) || !Array.isArray(references) || references.length > 64)
        return fail("invalid-definition", 400, "resources");
      const names = new Set<string>();
      for (const reference of references) {
        const resource = parseResource(reference);
        if (!resource || names.has(resource.name)) return fail("invalid-definition", 400, "resources");
        names.add(resource.name);
      }
    }
  }
  if (value.mcpServers !== undefined) {
    if (
      !plainObject(value.mcpServers) ||
      Object.keys(value.mcpServers).length > 32 ||
      Object.entries(value.mcpServers).some(([name, config]) => !validItemName(name) || !plainObject(config))
    )
      fail("invalid-definition", 400, "mcpServers");
  }
  if (value.settings !== undefined) {
    const settings = value.settings;
    if (
      !plainObject(settings) ||
      Object.keys(settings).some((k) => k !== "model" && k !== "thinking") ||
      (settings.model !== undefined && (typeof settings.model !== "string" || !/^[^/\s]{1,128}\/[^\s]{1,256}$/.test(settings.model))) ||
      (settings.thinking !== undefined && !THINKING_LEVELS.includes(settings.thinking as ThinkingLevel))
    )
      fail("invalid-definition", 400, "settings");
  }
  if (value.routines !== undefined) {
    const routines = value.routines;
    if (!Array.isArray(routines) || routines.length > 20) fail("invalid-definition", 400, "routines");
    const ids = new Set<string>();
    for (const routine of routines as Record<string, unknown>[]) {
      if (
        !plainObject(routine) ||
        Object.keys(routine).some((key) => !["id", "name", "cron", "prompt"].includes(key)) ||
        !validItemName(routine.id) ||
        ids.has(routine.id) ||
        typeof routine.cron !== "string" ||
        !parseCron(routine.cron) ||
        !nextRun(parseCron(routine.cron)!, new Date()) ||
        typeof routine.prompt !== "string" ||
        !routine.prompt.trim() ||
        routine.prompt.length > 8192
      )
        fail("invalid-definition", 400, "routines");
      text(routine.name, 80, true);
      ids.add(routine.id as string);
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) fail("limit");
  return structuredClone(value) as unknown as AgentDefinition;
}

/** Relative item file paths the UI may read and write inside one layer folder. */
export function itemPath(path: unknown): { type: ItemType; name: string } {
  if (typeof path !== "string") return fail("invalid-path");
  let match = /^(instructions|prompts)\/([^/\\]+)\.md$/.exec(path);
  if (match && validItemName(match[2])) return { type: match[1] as ItemType, name: match[2]! };
  match = /^skills\/([^/\\]+)\/SKILL\.md$/.exec(path);
  if (match && validItemName(match[1])) return { type: "skills", name: match[1]! };
  return fail("invalid-path");
}

/** An item file, or any file inside a skill's folder: what may be read. */
export function readablePath(path: unknown): void {
  if (typeof path !== "string") return fail("invalid-path");
  const skill = /^skills\/([^/\\]+)\/(.+)$/.exec(path);
  const inside = skill?.[2]?.split("/") ?? [];
  if (
    skill &&
    validItemName(skill[1]) &&
    inside.length <= 8 &&
    inside.every((part) => part && !part.startsWith(".") && !part.includes("\\"))
  )
    return;
  itemPath(path);
}

/**
 * Minimal YAML-ish frontmatter between `---` fences: `key: value` lines, including folded
 * (`>`, `>-`) and literal (`|`, `|-`) blocks of indented lines.
 */
export function frontmatter(source: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source };
  const data: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]!);
    if (!pair) continue;
    const value = pair[2]!.trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1]!) && !/^\S/.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
      data[pair[1]!] = block.join(value.startsWith(">") ? " " : "\n").trim();
    } else data[pair[1]!] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return { data, body: source.slice(match[0].length) };
}
