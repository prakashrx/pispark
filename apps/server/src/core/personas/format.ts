import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { SWITCH_PREFIX } from "../../contract/persona-protocol.js";
import type {
  ItemType,
  PersonaDefinition,
  ThinkingLevel,
} from "../../contract/persona-protocol.js";

export class PersonaError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly detail?: string,
  ) {
    super(code);
  }
}
export const fail = (code: string, status = 400, detail?: string): never => {
  throw new PersonaError(code, status, detail);
};

export const DEFAULT_PERSONA = "default";
/** Pi's built-in tools. The Default persona starts with all of them except powershell. */
export const BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "powershell",
] as const;
export const DEFAULT_TOOLS = BUILTIN_TOOLS.filter((t) => t !== "powershell");
export const ITEM_TYPES: ItemType[] = [
  "instructions",
  "skills",
  "prompts",
  "extensions",
  "mcp",
];
const THINKING: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** The key an extension gives a view it offers. */
const VIEW_KEY = /^[\w.:-]{1,64}$/;
export const validItemName = (name: unknown): name is string =>
  typeof name === "string" && NAME.test(name) && !name.endsWith(".");
export const validPersonaId = (id: unknown): id is string =>
  typeof id === "string" && ID.test(id);

/** "dev", "dev-2"… from a display name. */
export function slug(name: string, taken: (id: string) => boolean): string {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "persona";
  let id = base === DEFAULT_PERSONA ? "default-2" : base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

/** `skill:review`, `instruction:tone`, `prompt:x`, `extension:x`, `mcp:x` or `tool:bash`. */
export function parseSwitch(
  value: unknown,
): { type: ItemType | "tool"; name: string } | undefined {
  if (typeof value !== "string") return undefined;
  const at = value.indexOf(":");
  const prefix = value.slice(0, at);
  const name = value.slice(at + 1);
  const type = (Object.keys(SWITCH_PREFIX) as (ItemType | "tool")[]).find(
    (key) => SWITCH_PREFIX[key] === prefix,
  );
  if (at < 1 || !type || !validItemName(name)) return;
  return { type, name };
}

const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

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
    chatLayer = false,
    // A folder and a home view: not for Default, which every persona builds on, nor for a chat's
    // own layer, whose session already has both.
    binds = !chatLayer,
  }: { chatLayer?: boolean; binds?: boolean } = {},
): PersonaDefinition {
  if (!plainObject(value)) return fail("invalid-definition", 400, "object");
  const allowed = [
    "name",
    "description",
    "base",
    "on",
    "off",
    "mcpServers",
    "settings",
    ...(binds ? ["folder", "home"] : []),
  ];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail("invalid-definition", 400, unknown);
  text(value.name, 120, !chatLayer);
  text(value.description, 1024);
  text(value.folder, 4096);
  if (value.folder !== undefined && !isAbsolute(value.folder as string))
    fail("invalid-definition", 400, "folder");
  if (value.home !== undefined && (typeof value.home !== "string" || !VIEW_KEY.test(value.home)))
    fail("invalid-definition", 400, "home");
  if (value.base !== undefined) {
    if (
      !Array.isArray(value.base) ||
      value.base.length > 8 ||
      new Set(value.base).size !== value.base.length ||
      value.base.some((id) => !validPersonaId(id) || id === DEFAULT_PERSONA)
    )
      fail("invalid-definition", 400, "base");
  }
  for (const key of ["on", "off"] as const)
    if (value[key] !== undefined) {
      const list = value[key];
      if (
        !Array.isArray(list) ||
        list.length > 128 ||
        new Set(list).size !== list.length ||
        list.some((entry) => !parseSwitch(entry))
      )
        fail("invalid-definition", 400, key);
    }
  const on = new Set((value.on as string[] | undefined) ?? []);
  if (((value.off as string[] | undefined) ?? []).some((s) => on.has(s)))
    fail("invalid-definition", 400, "on-and-off");
  if (value.mcpServers !== undefined) {
    if (
      !plainObject(value.mcpServers) ||
      Object.keys(value.mcpServers).length > 32 ||
      Object.entries(value.mcpServers).some(
        ([name, config]) => !validItemName(name) || !plainObject(config),
      )
    )
      fail("invalid-definition", 400, "mcpServers");
  }
  if (value.settings !== undefined) {
    const settings = value.settings;
    if (
      !plainObject(settings) ||
      Object.keys(settings).some((k) => k !== "model" && k !== "thinking") ||
      (settings.model !== undefined &&
        (typeof settings.model !== "string" ||
          !/^[^/\s]{1,128}\/[^\s]{1,256}$/.test(settings.model))) ||
      (settings.thinking !== undefined &&
        !THINKING.includes(settings.thinking as ThinkingLevel))
    )
      fail("invalid-definition", 400, "settings");
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) fail("limit");
  return structuredClone(value) as unknown as PersonaDefinition;
}

/** Relative item file paths the UI may read and write inside one layer folder. */
export function itemPath(path: unknown): { type: ItemType; name: string } {
  if (typeof path !== "string") return fail("invalid-path");
  let match = /^(instructions|prompts)\/([^/\\]+)\.md$/.exec(path);
  if (match && validItemName(match[2]))
    return { type: match[1] as ItemType, name: match[2]! };
  match = /^skills\/([^/\\]+)\/SKILL\.md$/.exec(path);
  if (match && validItemName(match[1]))
    return { type: "skills", name: match[1]! };
  return fail("invalid-path");
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
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1]!) && !/^\S/.test(lines[i + 1]!))
        block.push(lines[++i]!.trim());
      data[pair[1]!] = block.join(value.startsWith(">") ? " " : "\n").trim();
    } else data[pair[1]!] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return { data, body: source.slice(match[0].length) };
}
