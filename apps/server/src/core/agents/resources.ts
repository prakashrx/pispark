import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ItemType, ResourceReference } from "../../contract/agent-protocol.js";
import { fail, frontmatter, validItemName } from "./format.js";

const MAX_FILE = 256 * 1024;
const MAX_ITEMS = 64;
const EXTENSIONS = [".ts", ".mjs", ".js"];

export interface LayerItem {
  type: ItemType;
  name: string;
  location?: string;
  path?: string;
  description?: string;
  config?: Record<string, unknown>;
  companions?: string[];
  reference?: ResourceReference;
  unavailable?: true;
}

function stat(path: string) {
  try {
    const found = lstatSync(path);
    return found.isSymbolicLink() ? undefined : found;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function readText(path: string): string {
  const file = stat(path);
  if (!file?.isFile()) return fail("invalid-path");
  if (file.size > MAX_FILE) return fail("limit");
  return readFileSync(path, "utf8");
}

function entries(folder: string) {
  return stat(folder)?.isDirectory()
    ? readdirSync(folder, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, MAX_ITEMS)
    : [];
}

export function resource(root: string, type: ItemType, name: string): LayerItem | undefined {
  const folder = join(root, type);
  if (!stat(root)?.isDirectory() || !stat(folder)?.isDirectory() || !validItemName(name)) return;
  const base = join(folder, name);
  if (type === "skills") {
    const skill = join(base, "SKILL.md");
    if (!stat(base)?.isDirectory() || !stat(skill)?.isFile()) return;
    const description = frontmatter(readText(skill)).data.description?.slice(0, 300);
    return { type, name, location: base, path: "skills/" + name + "/SKILL.md", description };
  }
  if (type === "extensions") {
    // A same-name entry file wins over a folder.
    const loose = EXTENSIONS.map((suffix) => base + suffix).find((path) => stat(path)?.isFile());
    if (loose) return { type, name, location: loose };
    if (!stat(base)?.isDirectory()) return;
    const location = ["index.ts", "index.js", "index.mjs"].map((name) => join(base, name)).find((path) => stat(path)?.isFile());
    if (!location) return;
    const companions = inventory(base, "skills").map((skill) => skill.location!);
    return { type, name, location, companions };
  }
  if (type === "mcp") {
    const path = base + ".json";
    if (!stat(path)?.isFile()) return;
    let config: unknown;
    try { config = JSON.parse(readText(path)); }
    catch { return; }
    if (!config || typeof config !== "object" || Array.isArray(config)) return;
    return { type, name, config: config as Record<string, unknown> };
  }
  const preferred = name + ".md";
  const file = stat(join(folder, preferred))?.isFile() ? preferred
    : entries(folder).find((entry) => entry.isFile() && /\.md$/i.test(entry.name) && entry.name.slice(0, -3) === name)?.name;
  if (!file) return;
  const location = join(folder, file);
  const description = type === "prompts" ? promptDescription(readText(location)) : undefined;
  return { type, name, location, path: type + "/" + file, description };
}

/** A skill's files besides SKILL.md, a few levels deep, bounded. */
export function skillFiles(base: string): string[] {
  const found: string[] = [];
  const walk = (folder: string, prefix: string, depth: number) => {
    for (const entry of entries(folder)) {
      if (found.length >= MAX_ITEMS) return;
      if (entry.name === "node_modules") continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) {
        if (depth < 4) walk(join(folder, entry.name), relative + "/", depth + 1);
      } else if (entry.isFile() && relative !== "SKILL.md") found.push(relative);
    }
  };
  walk(base, "", 0);
  return found;
}

function promptDescription(text: string): string | undefined {
  const { data, body } = frontmatter(text);
  return (data.description || body.split(/\r?\n/).find((line) => line.trim())?.trim())?.slice(0, 200);
}

/** Files here are candidates. Only an explicit reference selects them. */
export function inventory(root: string, type: ItemType): LayerItem[] {
  if (!stat(root)?.isDirectory()) return [];
  const names = new Set<string>();
  for (const entry of entries(join(root, type))) {
    const suffix = type === "extensions" ? /\.(ts|mjs|js)$/ : type === "mcp" ? /\.json$/ : /\.md$/i;
    const name = entry.isDirectory() && (type === "extensions" || type === "skills")
      ? entry.name
      : entry.isFile() && type !== "skills" && suffix.test(entry.name) ? entry.name.replace(suffix, "") : undefined;
    if (validItemName(name)) names.add(name);
  }
  return [...names].flatMap((name) => {
    const item = resource(root, type, name);
    return item ? [item] : [];
  });
}
