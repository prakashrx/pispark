import type {
  ItemType,
  LayerRef,
  ResolvedItem,
} from "../../../../server/src/contract/persona-protocol";

const messages: Record<string, string> = {
  "invalid-input": "That request wasn’t valid.",
  "invalid-path": "That file name isn’t allowed.",
  "invalid-definition": "That persona setting isn’t valid.",
  "revision-conflict": "This changed somewhere else. The latest version is shown; try again.",
  "missing-parent": "A persona this one builds on is missing",
  cycle: "Personas can’t build on each other in a loop",
  "in-use": "Another persona builds on this one",
  "built-in": "Default can’t be deleted.",
  "not-found": "Not found.",
  limit: "That’s too large.",
  folder: "That folder doesn’t exist on the server.",
  storage: "Couldn’t read or save on the server.",
};

/** Plain-language persona errors; details are persona IDs, never file contents. */
export function personaError(code: string, detail?: string): string {
  const message = messages[code] ?? "Something went wrong.";
  return detail && ["missing-parent", "cycle", "in-use"].includes(code)
    ? `${message}: ${detail}.`
    : message;
}

export const ITEM_LABELS: Record<ItemType, { title: string; one: string }> = {
  instructions: { title: "Instructions", one: "instruction" },
  skills: { title: "Skills", one: "skill" },
  prompts: { title: "Commands", one: "command" },
  extensions: { title: "Extensions", one: "extension" },
  mcp: { title: "MCP servers", one: "MCP server" },
};

/** Where an item comes from, relative to the layer being edited. */
export function originLabel(origin: LayerRef, viewing: string): string {
  if (origin.id === viewing) return "Added here";
  if (origin.id === "chat") return "From this chat";
  return `From ${origin.name}`;
}

/** Why an item is in its current state, when a layer switched it. */
export function switchLabel(item: ResolvedItem, viewing: string): string {
  if (!item.switchedBy) return item.replaced.length ? "Replaces an inherited one" : "";
  const who = item.switchedBy.id === viewing ? "here" : `by ${item.switchedBy.name}`;
  return item.on ? `Turned back on ${who}` : `Turned off ${who}`;
}

/** Starting text for a new item file. */
export function template(type: ItemType, name: string): string {
  if (type === "skills")
    return `---\nname: ${name}\ndescription: What this skill does and when to use it.\n---\n\n# ${name}\n\n`;
  if (type === "prompts")
    return `---\ndescription: What this command does\nargument-hint: "[topic]"\n---\n\nWrite the prompt here. Use $1 for the first argument.\n`;
  return "";
}
