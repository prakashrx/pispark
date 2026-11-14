/** Test-only data roots: a temporary PISPARK_HOME, local folders and persona folders. */
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfiguration } from "../../src/core/runtime/configuration.js";
import type { PersonaDefinition } from "../../src/contract/persona-protocol.js";
import { WORKSPACE_POINTS } from "../../src/http/workspace-points.js";
import { LocalProviderControl } from "./local-provider.js";

export const controlledExtension = fileURLToPath(
  new URL("./controlled-extension.mjs", import.meta.url),
);

/** Write `<home>/personas/<id>/persona.json` plus any item files (paths relative to the folder). */
export async function writePersona(
  home: string,
  id: string,
  definition: PersonaDefinition,
  files: Record<string, string> = {},
): Promise<string> {
  const dir = join(home, "personas", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "persona.json"), JSON.stringify(definition, null, 2));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

export const viewExtension = fileURLToPath(new URL("./view-extension/", import.meta.url));

/** Add the extension that places Svelte components through Pi's bus to a persona, as a folder. */
export async function addViewExtension(home: string, id: string) {
  await cp(viewExtension, join(home, "personas", id, "extensions", "views"), { recursive: true });
}

export const frontendExtension = fileURLToPath(new URL("./frontend-extension/", import.meta.url));

/** Add the extension that supplies its own frontend for the chat to a persona, as a folder. */
export async function addFrontendExtension(home: string, id: string) {
  await cp(frontendExtension, join(home, "personas", id, "extensions", "frontend"), { recursive: true });
}

/** Add the controlled test extension to a persona folder. */
export async function addControlledExtension(home: string, id: string) {
  const dir = join(home, "personas", id, "extensions");
  await mkdir(dir, { recursive: true });
  await copyFile(controlledExtension, join(dir, "controlled.mjs"));
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
  /** Pi's JSONL entries for a chat. */
  const history = async (id: string) => {
    const dir = join(home, "chats", id);
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
    persona: (id: string, definition: PersonaDefinition, files?: Record<string, string>) =>
      writePersona(home, id, definition, files),
    // Windows releases a folder a moment after the last process in it has gone.
    remove: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

/** The Default persona most runtime tests use: read only, the controlled extension and a marker. */
export async function standardDefault(home: string, marker = "system-default") {
  await writePersona(
    home,
    "default",
    { name: "Default", on: ["tool:read"] },
    { "instructions/system.md": marker },
  );
  await addControlledExtension(home, "default");
}
