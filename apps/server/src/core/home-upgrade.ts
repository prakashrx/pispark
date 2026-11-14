import { existsSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Data layout 1 → 2: agents and sessions got their names. Layout 1 kept them as `personas/<id>/persona.json`
 * and `chats/<id>/chat.json` (with a `persona` field and an optional `persona/` layer). This is the one place
 * those old names remain. Each step only renames, so an upgrade that stops half way finishes at the next start.
 */
export function upgradeToLayout2(root: string): void {
  const OLD = { agents: "personas", agentFile: "persona.json", sessions: "chats", sessionFile: "chat.json", layer: "persona", field: "persona" };
  const agents = join(root, "agents");
  const sessions = join(root, "sessions");
  moveFolder(join(root, OLD.agents), agents);
  moveFolder(join(root, OLD.sessions), sessions);
  for (const id of folders(agents)) renameIfMissing(join(agents, id, OLD.agentFile), join(agents, id, "agent.json"));
  for (const id of folders(sessions)) {
    const folder = join(sessions, id);
    const oldFile = join(folder, OLD.sessionFile);
    const file = join(folder, "session.json");
    if (existsSync(oldFile) && !existsSync(file)) {
      const metadata = JSON.parse(readFileSync(oldFile, "utf8")) as Record<string, unknown>;
      if (OLD.field in metadata) {
        const { [OLD.field]: agent, ...rest } = metadata;
        writeFileSync(file, JSON.stringify(withAgent(rest, agent), null, 2) + "\n");
      } else writeFileSync(file, JSON.stringify(metadata, null, 2) + "\n");
    }
    if (existsSync(file) && existsSync(oldFile)) unlinkSync(oldFile);
    const layer = join(folder, "agent");
    moveFolder(join(folder, OLD.layer), layer);
    if (existsSync(layer)) renameIfMissing(join(layer, OLD.agentFile), join(layer, "agent.json"));
  }
}

/** Puts `agent` where the old field stood (after `cwd`), so the file reads as before. */
function withAgent(rest: Record<string, unknown>, agent: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    out[key] = value;
    if (key === "cwd") out.agent = agent;
  }
  if (!("agent" in out)) out.agent = agent;
  return out;
}

/** Moves a folder to its new name; when both exist (an upgrade that stopped), moves what is left. */
function moveFolder(from: string, to: string): void {
  if (!isFolder(from)) return;
  if (!existsSync(to)) return renameSync(from, to);
  for (const name of readdirSync(from)) renameIfMissing(join(from, name), join(to, name));
  if (readdirSync(from).length === 0) rmdirSync(from);
}

function renameIfMissing(from: string, to: string): void {
  if (existsSync(from) && !existsSync(to)) renameSync(from, to);
}

function folders(dir: string): string[] {
  if (!isFolder(dir)) return [];
  return readdirSync(dir).filter((name) => isFolder(join(dir, name)));
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
