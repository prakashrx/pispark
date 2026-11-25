import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentTarget } from "../../contract/agent-protocol.js";
import { AgentStore, writeAtomic } from "./store.js";
import { resolveSetup } from "./resolve.js";
import { digest } from "./format.js";

function targets(store: AgentStore): AgentTarget[] {
  const agents = store.list().filter((agent) => !agent.bundled).map(({ id }) => ({ agent: id }));
  const sessions = readdirSync(store.sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(entry.name))
    .map(({ name }) => ({ session: name }))
    .filter((target) => store.exists(target));
  return [...agents, ...sessions];
}

/** Run with the data home locked. Legacy and explicit layers can coexist after interruption. */
export function migrateAgentResources(store: AgentStore, apply: boolean) {
  const before = targets(store).map((target) => {
    const { definition, revision } = store.read(target);
    return { target, definition, revision, fingerprint: resolveSetup(store, target).fingerprint };
  });
  const pending = before.filter(({ definition }) => !definition.resources);
  if (!apply || !pending.length) return { definitions: before.length, pending: pending.length, converted: 0 };

  const backup = "agent-resource-backups/" + randomUUID();
  const changed: { path: string; previous: string; revision: string }[] = [];
  try {
    const prepared = pending.map(({ target, definition, revision }) => {
      const config = join(store.dir(target), "agent.json");
      const previous = readFileSync(config, "utf8");
      const saved = "agent" in target
        ? join(store.agentsDir, "..", backup, "agents", target.agent)
        : join(store.agentsDir, "..", backup, "sessions", target.session, "agent");
      mkdirSync(saved, { recursive: true, mode: 0o700 });
      writeAtomic(join(saved, "agent.json"), previous);
      return { config, previous, definition, revision, target };
    });
    for (const { config, previous, definition, revision, target } of prepared) {
      const resources = store.declarations(target, definition);
      const saved = store.save(target, revision, { ...definition, resources });
      changed.push({ path: config, previous, revision: saved.revision });
    }
    for (const { target, fingerprint } of before)
      if (resolveSetup(store, target).fingerprint !== fingerprint)
        throw new Error("The resolved setup changed during migration.");
    return { definitions: before.length, pending: 0, converted: changed.length, backup };
  } catch {
    for (const { path, previous, revision } of changed.reverse()) {
      try {
        if (digest(readFileSync(path)) === revision) writeAtomic(path, previous);
      } catch {
        // Keep the backup even if an external change prevents automatic recovery.
      }
    }
    throw new Error("Agent resource migration failed. Check the backup under " + backup + ".");
  }
}
