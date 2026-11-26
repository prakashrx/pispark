/** Test-only data roots: a temporary PISPARK_HOME, local folders and agent folders. */
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfiguration } from "../../src/core/runtime/configuration.js";
import type { AgentDefinition, AgentResources, ItemType } from "../../src/contract/agent-protocol.js";
import { ITEM_TYPES } from "../../src/core/agents/format.js";
import { WORKSPACE_POINTS } from "../../src/http/workspace-points.js";
import { LocalProviderControl } from "./local-provider.js";

export const controlledExtension = fileURLToPath(
  new URL("./controlled-extension.mjs", import.meta.url),
);

/** The item a file in an agent folder is, as its `resources` names it: `skills/x/SKILL.md` is skill `x`. */
function itemOf(path: string): [ItemType, string] | undefined {
  const [type, name] = path.split("/");
  if (!type || !name || !(ITEM_TYPES as readonly string[]).includes(type)) return undefined;
  return [type as ItemType, type === "skills" || (type === "extensions" && path.split("/").length > 2) ? name : name.replace(/\.[^.]+$/, "")];
}

/** Selects `local:<name>` items in an agent's own definition, as the agent page or Agent Builder would. */
export async function selectLocal(home: string, id: string, items: [ItemType, string][]): Promise<void> {
  const file = join(home, "agents", id, "agent.json");
  const definition = JSON.parse(await readFile(file, "utf8")) as AgentDefinition;
  const resources: AgentResources = definition.resources ?? {};
  for (const [type, name] of items) {
    const list = (resources[type] ??= []);
    if (!list.includes(`local:${name}`)) list.push(`local:${name}`);
  }
  await writeFile(file, JSON.stringify({ ...definition, resources }, null, 2));
}

/**
 * Write `<home>/agents/<id>/agent.json` plus any item files (paths relative to the folder). Each item
 * file is selected in `resources`, unless the definition names its own.
 */
export async function writeAgent(
  home: string,
  id: string,
  definition: AgentDefinition,
  files: Record<string, string> = {},
): Promise<string> {
  const dir = join(home, "agents", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "agent.json"), JSON.stringify(definition, null, 2));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  if (!definition.resources)
    await selectLocal(home, id, [...new Set(Object.keys(files).map(itemOf).filter((item) => !!item).map((item) => item!.join("\0")))].map((key) => key.split("\0") as [ItemType, string]));
  return dir;
}

export const viewExtension = fileURLToPath(new URL("./view-extension/", import.meta.url));

/** Add the extension that places Svelte components through Pi's bus to an agent, as a folder. */
export async function addViewExtension(home: string, id: string) {
  await cp(viewExtension, join(home, "agents", id, "extensions", "views"), { recursive: true });
  await selectLocal(home, id, [["extensions", "views"]]);
}

export const frontendExtension = fileURLToPath(new URL("./frontend-extension/", import.meta.url));

/** Add the extension that supplies its own frontend for the session to an agent, as a folder. */
export async function addFrontendExtension(home: string, id: string) {
  await cp(frontendExtension, join(home, "agents", id, "extensions", "frontend"), { recursive: true });
  await selectLocal(home, id, [["extensions", "frontend"]]);
}

/** Add the controlled test extension to an agent folder. */
export async function addControlledExtension(home: string, id: string) {
  const dir = join(home, "agents", id, "extensions");
  await mkdir(dir, { recursive: true });
  await copyFile(controlledExtension, join(dir, "controlled.mjs"));
  await selectLocal(home, id, [["extensions", "controlled"]]);
}

export async function testHome(prefix = "pispark-test-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  const provider = new LocalProviderControl();
  const configuration: RuntimeConfiguration = {
    home,
    points: WORKSPACE_POINTS,
    fixedModel: { provider: provider.provider, id: "deterministic" },
  };
  /** A working folder under the test root. */
  const folder = async (name: string, files: Record<string, string> = {}) => {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
    return dir;
  };
  /** Pi's JSONL entries for a session. */
  const history = async (id: string) => {
    const dir = join(home, "sessions", id);
    const file = (await readdir(dir)).find((name) => name.endsWith(".jsonl"))!;
    return (await readFile(join(dir, file), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  };
  return {
    root,
    home,
    provider,
    configuration,
    folder,
    history,
    agent: (id: string, definition: AgentDefinition, files?: Record<string, string>) =>
      writeAgent(home, id, definition, files),
    // Windows releases a folder a moment after the last process in it has gone.
    remove: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

/** The Default agent most runtime tests use: read only, the controlled extension and a marker. */
export async function standardDefault(home: string, marker = "system-default") {
  await writeAgent(
    home,
    "default",
    { name: "Default", on: ["tool:read"] },
    { "instructions/system.md": marker },
  );
  await addControlledExtension(home, "default");
}
