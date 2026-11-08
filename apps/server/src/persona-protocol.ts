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

/** Switch prefixes in persona.json: `skill:review`, `instruction:tone`, `tool:bash`… */
export const SWITCH_PREFIX: Record<ItemType | "tool", string> = {
  instructions: "instruction",
  skills: "skill",
  prompts: "prompt",
  extensions: "extension",
  mcp: "mcp",
  tool: "tool",
};
export const switchName = (type: ItemType | "tool", name: string) =>
  `${SWITCH_PREFIX[type]}:${name}`;

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

export interface ResolvedTool {
  name: string;
  on: boolean;
  builtIn: boolean;
  /** The last layer that switched it. */
  setBy?: LayerRef;
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
}
