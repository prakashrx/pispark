import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Agent Builder's guard and orientation. The agent it edits is its working folder (or, when that
 * isn't an agent's folder, the one the person names):
 * - `edit` and `write` inside that folder run as usual;
 * - anywhere else (a shared resource, another agent, any other file), the person is asked first;
 * - files the app ships (`plugins/`) are refused: an update replaces them.
 * It also tells the model where the agent and the documentation are. It knows nothing about any
 * page, so it works the same wherever the session is opened.
 */

// <app>/plugins/agents/agent-builder/extensions/agent-builder/index.ts
const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PLUGINS = join(APP, "plugins");
const WRITES = new Set(["edit", "write"]);

/** The real path, following links, for a file that may not exist yet. */
function real(path: string): string {
  let existing = path;
  const rest: string[] = [];
  while (!existsSync(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  try {
    return join(realpathSync(existing), ...rest);
  } catch {
    return path;
  }
}

export function inside(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function target(path: string, cwd: string): string {
  const expanded = path === "~" || path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(1)) : path;
  return real(resolve(cwd, expanded.replace(/^@/, "")));
}

/** PiSpark's data folder: the one the working folder is an agent of, else `PISPARK_HOME` or `~/.pispark`. */
export function dataFolder(cwd: string): string {
  if (basename(dirname(cwd)) === "agents") return dirname(dirname(cwd));
  const home = process.env.PISPARK_HOME;
  if (!home) return join(homedir(), ".pispark");
  return home === "~" || home.startsWith("~/") || home.startsWith("~\\") ? join(homedir(), home.slice(1)) : home;
}

/** Where a file outside the agent sits, in the person's words. */
export function whereIs(path: string, cwd: string): string {
  const home = real(dataFolder(cwd));
  const agents = join(home, "agents");
  if (inside(path, join(home, "resources"))) {
    const [kind, name] = relative(join(home, "resources"), path).split(sep);
    const one = { skills: "skill", instructions: "instruction", prompts: "prompt", extensions: "extension" }[kind ?? ""];
    return one && name ? `the shared ${one} "${name.replace(/\.(md|ts|js|mjs)$/, "")}". Every agent that uses it changes too.` : "the Shared library. Every agent that uses it changes too.";
  }
  if (inside(path, agents)) {
    const [agent] = relative(agents, path).split(sep);
    return `the agent "${agent}". It and every agent built on it change too.`;
  }
  return "a folder outside this agent.";
}

export default function agentBuilder(pi: ExtensionAPI) {
  /** Files the person has already allowed in this session. */
  const allowed = new Set<string>();

  pi.on("tool_call", async (event, ctx) => {
    if (!WRITES.has(event.toolName)) return;
    const input = event.input as { path?: unknown };
    if (typeof input.path !== "string" || !input.path) return;
    const cwd = real(ctx.cwd);
    const path = target(input.path, cwd);
    if (inside(path, cwd)) return;
    if (inside(path, real(PLUGINS)))
      return {
        block: true,
        reason: `${input.path} ships with PiSpark and is replaced when it updates, so it can't be changed. To change it for this agent, copy it into this agent's folder under the same name and reference it as local:.`,
      };
    if (allowed.has(path)) return;
    const ok = await ctx.ui.confirm(
      "Change a file outside this agent?",
      `Agent Builder wants to ${event.toolName === "edit" ? "edit" : "write"} ${path}, in ${whereIs(path, cwd)}`,
    );
    if (ok) {
      allowed.add(path);
      return;
    }
    return {
      block: true,
      reason: `The person said no to changing ${input.path}. Don't try again. If it's a shared or inherited item, offer to make a copy in this agent's folder instead, referenced as local:.`,
    };
  });

  pi.on("before_agent_start", (event, ctx) => {
    const agent = existsSync(join(ctx.cwd, "agent.json"));
    const piDocs = join(APP, "node_modules", "@earendil-works", "pi-coding-agent", "docs");
    const lines = [
      "## Agent Builder",
      agent
        ? `The agent you're building is in your working folder, ${ctx.cwd}. Its definition is agent.json there. Change files in this folder; the person is asked before you change anything outside it.`
        : `Your working folder, ${ctx.cwd}, isn't an agent's folder (it has no agent.json). Each agent is a folder in ${join(dataFolder(ctx.cwd), "agents")}, and the Shared library is ${join(dataFolder(ctx.cwd), "resources")}. Ask the person which agent to work on before changing anything; they're asked before each change outside your working folder.`,
      `PiSpark's documentation: ${join(APP, "docs")} (agents.md for the agent format and layering, extensions.md for extensions in PiSpark).`,
      ...(existsSync(piDocs) ? [`Pi's documentation: ${piDocs} (skills.md, prompt-templates.md, extensions.md; search extensions.md rather than reading it whole).`] : []),
    ];
    return { systemPrompt: `${event.systemPrompt}\n\n${lines.join("\n")}` };
  });
}
