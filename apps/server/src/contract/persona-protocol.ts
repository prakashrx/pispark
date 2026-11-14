/** Persona contract shared by the server and web client. See docs/personas.md. */
export type ItemType = "instructions" | "skills" | "prompts" | "extensions" | "mcp";
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/**
 * Switch prefixes in persona.json: `skill:review`, `instruction:tone`, `tool:bash`… Two say what
 * may run unattended and are off unless switched on: `routine:<id>` (one of its routines) and
 * `hold:<extension>` (that extension may keep its sessions loaded while no one watches).
 */
export type SwitchType = ItemType | "tool" | "routine" | "hold";
export const SWITCH_PREFIX: Record<SwitchType, string> = {
  instructions: "instruction",
  skills: "skill",
  prompts: "prompt",
  extensions: "extension",
  mcp: "mcp",
  tool: "tool",
  routine: "routine",
  hold: "hold",
};
export const switchName = (type: SwitchType, name: string) =>
  `${SWITCH_PREFIX[type]}:${name}`;

/**
 * What a persona (typically an app) offers to run on a schedule: each run is a new session of the
 * persona. Off until the person switches it on with `routine:<id>`.
 */
export interface RoutineDefinition {
  id: string;
  name: string;
  /** Five fields, the server's local time. */
  cron: string;
  prompt: string;
}

/** Contents of persona.json. Files in the persona folder add instructions, skills, prompts and extensions. */
export interface PersonaDefinition {
  name?: string;
  description?: string;
  /** Parent persona IDs. Default is always the first layer and is never listed. */
  base?: string[];
  /** `type:name` switches. `tool:bash` turns a tool on; `skill:poetry` turns an inherited item back on. */
  on?: string[];
  /** `type:name` switches that turn inherited items or tools off. */
  off?: string[];
  /** Pi `mcp.json` server entries. Resolved, not yet connected. */
  mcpServers?: Record<string, Record<string, unknown>>;
  settings?: { model?: string; thinking?: ThinkingLevel };
  /**
   * The folder on the backend host this persona always works in, which makes it a project persona.
   * Inherited like the settings: the nearest layer that names one wins.
   */
  folder?: string;
  /**
   * The key of the `session.view` its sessions open on, which makes it an app persona: opened
   * rather than chatted with. Inherited like the folder.
   */
  home?: string;
  /** What it offers to run on a schedule; inherited like the folder (the nearest layer's list). */
  routines?: RoutineDefinition[];
}

/** A persona by ID, or the layer a chat owns after an in-chat edit. */
export type PersonaTarget = { persona: string } | { chat: string };

export interface LayerRef {
  /** Persona ID, or "chat" for a chat's own layer. */
  id: string;
  name: string;
}

export interface PersonaSummary {
  id: string;
  name: string;
  description?: string;
  base: string[];
  /** The folder it works in, its own or a parent's: Ask uses it instead of asking for one. */
  folder?: string;
  /** The view its sessions open on, its own or a parent's: an app persona has one. */
  home?: string;
  builtIn: boolean;
  /** False when persona.json can't be read or resolved; `error` says why. */
  valid: boolean;
  error?: string;
}

export interface ResolvedItem {
  type: ItemType;
  name: string;
  on: boolean;
  /** The layer whose folder (or mcpServers) provides the item. */
  origin: LayerRef;
  /** Earlier layers whose item of the same name this one replaces. */
  replaced: LayerRef[];
  /** The last layer that switched it on or off, when not simply added. */
  switchedBy?: LayerRef;
  description?: string;
  /** File path inside the origin layer, for instructions, prompts and skills. */
  path?: string;
}

/**
 * Where a tool comes from: PiSpark's core (Pi's built-in tools and PiSpark's own built-in
 * extension), one of the persona's extensions, or an MCP server.
 */
export type ToolSource = { kind: "core" } | { kind: "extension"; name: string } | { kind: "mcp"; name: string };
/** A tool found by loading the persona's extensions (no session, no model). */
export interface DiscoveredTool {
  name: string;
  /** The extension's short name for it. */
  label?: string;
  description?: string;
  source: ToolSource;
}
export interface ResolvedTool {
  name: string;
  on: boolean;
  builtIn: boolean;
  /** The last layer that switched it. */
  setBy?: LayerRef;
  /** Where it comes from; absent when a switch names a tool nothing provides now. */
  source?: ToolSource;
  label?: string;
  description?: string;
}

export interface PersonaView {
  target: PersonaTarget;
  definition: PersonaDefinition;
  /** Hash of persona.json; send it back to save. Empty for a chat with no layer yet. */
  revision: string;
  /** Resolution order, Default first, the viewed layer last. */
  layers: LayerRef[];
  items: ResolvedItem[];
  tools: ResolvedTool[];
  settings: { model?: string; thinking?: ThinkingLevel };
  /** The folder and the home view it resolves to, its own or a parent's. */
  folder?: string;
  home?: string;
  /** Some extensions could not be loaded to list their tools. */
  toolsIncomplete?: true;
  /** Set when the setup can't be resolved, e.g. a missing parent or a cycle. */
  error?: string;
  detail?: string;
}

export interface ItemFile {
  text: string;
  revision: string;
}

/** What a chat reports about its persona. */
export interface ChatPersona {
  id: string;
  name: string;
  /** True once the chat has its own layer on top of the persona. */
  layered: boolean;
  /** An app persona's home view: the one this session shows first. */
  home?: string;
}
