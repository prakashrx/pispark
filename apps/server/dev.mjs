// Development server: runs src/index.ts and restarts it when a file under src/ is edited.
//
// Not `node --watch`: on Windows it also restarts when a file is only read (Windows reports the
// last-access time update as a change), e.g. each time Pi loads extensions/pispark.ts for a chat;
// and with --env-file it watches the whole folder of the .env file. Here a change counts only if
// the file's modification time or size moved.
import { spawn } from "node:child_process";
import { readdirSync, statSync, watch } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./src/", import.meta.url));
const args = ["--env-file-if-exists=../../.env", "--import", "tsx", "--no-warnings", "src/index.ts", ...process.argv.slice(2)];
const seen = new Map();
let child;
let timer;

const stamp = (file) => {
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "gone";
  }
};
const start = () => {
  child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal || code === null) return;
    if (code !== 0) console.log(`Server exited with code ${code}. Waiting for a change in src/ to restart.`);
  });
};
const restart = () => {
  console.log("Restarting: src/ changed");
  if (!child || child.exitCode !== null) return start();
  child.once("exit", start);
  child.kill();
};

watch(root, { recursive: true }, (_event, name) => {
  if (!name) return;
  const file = join(root, String(name));
  const now = stamp(file);
  if (seen.get(file) === now) return; // Read, not written.
  seen.set(file, now);
  clearTimeout(timer);
  timer = setTimeout(restart, 200);
});
// What every file looks like now, so a later read of it is not taken for an edit.
for (const name of readdirSync(root, { recursive: true })) seen.set(join(root, String(name)), stamp(join(root, String(name))));
// Stopping the runner stops the server, then the runner.
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (!child || child.exitCode !== null) process.exit(0);
    child.once("exit", () => process.exit(0));
    child.kill(signal);
  });
start();
