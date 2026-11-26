import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { canonical, within, write } from "./store.js";

/**
 * Where what the person says already belongs. Their lasting instructions go into the files they
 * would have edited themselves, which PiSpark loads into every session: the project's `AGENTS.md`,
 * this agent's own instructions, or Default's for every agent. This finds those files; the agent
 * edits them with its ordinary tools.
 */

export interface Homes {
  /** The place's `AGENTS.md`, when this agent reads it. */
  project?: string;
  /** This agent's own instruction files, or the one to start when it has none. */
  own: string[];
  /** Default's instruction files (every agent builds on Default), or the one to start. */
  everyone: string[];
}

/** PiSpark's bus channel for a session's own requests; `inspect` answers at once with its agent. */
const SESSION_REQUEST = "pispark:session-request";
/** The instruction file started for an agent that has none of its own. */
const STARTED = "standing";

const key = (file: string) => (process.platform === "win32" ? canonical(file).toLowerCase() : canonical(file));
const samePath = (a: string, b: string) => key(a) === key(b);
const inside = (dir: string, file: string) => within(dir, file) !== undefined;

/** The agent this session uses, as PiSpark names it. Nothing outside PiSpark. */
function agentId(pi: ExtensionAPI): string | undefined {
  let answer: { ok: boolean; text: string } | undefined;
  pi.events.emit(SESSION_REQUEST, { request: { action: "inspect" }, reply: (value: { ok: boolean; text: string }) => (answer = value) });
  try {
    const agent = answer?.ok ? (JSON.parse(answer.text) as { agent?: unknown }).agent : undefined;
    return typeof agent === "string" && /^[\w.-]+$/.test(agent) ? agent : undefined;
  } catch {
    return undefined;
  }
}

/** PiSpark keeps a session's transcript in `<data folder>/sessions/<id>/`, and agents in `<data folder>/agents/<id>/`. */
function agentsDir(ctx: ExtensionContext): string | undefined {
  const transcript = ctx.sessionManager.getSessionFile();
  const dir = transcript ? join(dirname(dirname(dirname(transcript))), "agents") : undefined;
  return dir && existsSync(dir) ? dir : undefined;
}

/** An agent's own instruction files: the ones its definition selects from its own folder. */
function instructionsOf(agent: string): string[] {
  try {
    const definition = JSON.parse(readFileSync(join(agent, "agent.json"), "utf8")) as { resources?: { instructions?: unknown } };
    const folder = join(agent, "instructions");
    const names = definition.resources
      ? (Array.isArray(definition.resources.instructions) ? definition.resources.instructions : [])
          .filter((each): each is string => typeof each === "string" && each.startsWith("local:"))
          .map((each) => each.slice("local:".length))
      : readdirSync(folder).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3));
    const files = names.map((name) => join(folder, `${name}.md`)).filter((file) => existsSync(file));
    return files.length ? files : [join(folder, `${STARTED}.md`)];
  } catch {
    return [];
  }
}

export function findHomes(pi: ExtensionAPI, ctx: ExtensionContext, contextFiles: readonly { path: string }[] = []): Homes {
  // The place's own AGENTS.md if it is one of the files this session was given; a project agent
  // whose folder has none yet can start one.
  const names = ["AGENTS.md", "CLAUDE.md"];
  const own = contextFiles.find((file) => samePath(dirname(file.path), ctx.cwd) && names.includes(basename(file.path)));
  const project = own?.path ?? (contextFiles.length ? join(ctx.cwd, "AGENTS.md") : undefined);
  const agents = agentsDir(ctx);
  const id = agents ? agentId(pi) : undefined;
  const mine = agents && id ? instructionsOf(join(agents, id)) : [];
  const everyone = agents && id !== "default" ? instructionsOf(join(agents, "default")) : [];
  return { ...(project ? { project } : {}), own: mine, everyone };
}

/** Whether a file is one of the instruction homes: how the person would name it, and whether it is an agent's. */
export function homeOf(homes: Homes | undefined, place: string, file: string): { label: string; agent: boolean } | undefined {
  if (!homes) return undefined;
  if (homes.project && samePath(homes.project, file)) return { label: relative(place, file) || basename(file), agent: false };
  for (const [files, label] of [[homes.own, "Agent instructions"], [homes.everyone, "Default's instructions"]] as const)
    if (files[0] && file.toLowerCase().endsWith(".md") && inside(dirname(files[0]), file)) return { label: `${label}: ${basename(file)}`, agent: true };
  return undefined;
}

/**
 * An instruction file the agent just started only loads once its agent's definition selects it.
 * Adds that selection (`local:<name>`), as the editor does when a person adds an instruction.
 */
export async function select(file: string): Promise<void> {
  const definitionFile = join(dirname(dirname(file)), "agent.json");
  const name = basename(file, ".md");
  let definition: { resources?: { instructions?: string[] } };
  try {
    definition = JSON.parse(await readFile(definitionFile, "utf8"));
  } catch {
    return;
  }
  // A definition without `resources` loads every file in its folder already.
  if (!definition.resources || typeof definition.resources !== "object") return;
  const selected = Array.isArray(definition.resources.instructions) ? definition.resources.instructions : [];
  if (selected.includes(`local:${name}`)) return;
  definition.resources.instructions = [...selected, `local:${name}`];
  await write(definitionFile, JSON.stringify(definition, null, 2) + "\n");
}
