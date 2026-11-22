import { existsSync } from "node:fs";
import { join } from "node:path";
import { AgentStore } from "./store.js";
import { migrateAgentResources } from "./migrate.js";
import { homePaths, lockHome, resolveHome } from "../home.js";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--apply"))
  throw new Error("Usage: migrate-cli.js [--apply]");
const paths = homePaths(resolveHome());
if (!existsSync(join(paths.root, "home.json"))) throw new Error("Choose an existing PiSpark data folder.");
const unlock = lockHome(paths);
try {
  const store = new AgentStore(paths.agents, paths.sessions, () => "default");
  try {
    console.log(JSON.stringify(migrateAgentResources(store, args[0] === "--apply")));
  } finally {
    await store.shutdown();
  }
} finally {
  unlock();
}
