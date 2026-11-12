import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Every PiSpark folder comes from one data root. Nothing is read from terminal Pi. */
export interface HomePaths {
  root: string;
  chats: string;
  personas: string;
  /** `apps/<persona id>/`: the place of an app persona that has no folder of its own. */
  apps: string;
  providers: string;
  logs: string;
  /** PiSpark's own settings file. */
  settings: string;
}

export function homePaths(root: string): HomePaths {
  const base = resolve(root);
  return {
    root: base,
    chats: join(base, "chats"),
    personas: join(base, "personas"),
    apps: join(base, "apps"),
    providers: join(base, "providers"),
    logs: join(base, "logs"),
    settings: join(base, "settings.json"),
  };
}

/** `PISPARK_HOME`, with a leading `~` expanded, or `~/.pispark`. */
export function resolveHome(value = process.env.PISPARK_HOME): string {
  const input = value?.trim() || join(homedir(), ".pispark");
  const expanded = /^~(?=$|[\\/])/.test(input)
    ? join(homedir(), input.slice(1))
    : input;
  if (!isAbsolute(expanded))
    throw new Error("PISPARK_HOME must be an absolute path (or start with ~).");
  return resolve(expanded);
}

export function prepareHome(root: string): HomePaths {
  const paths = homePaths(root);
  for (const dir of [paths.root, paths.chats, paths.personas, paths.providers])
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  return paths;
}

/**
 * One server per data root. A lock left by a process that no longer exists is replaced.
 * Returns the release function.
 */
export function lockHome(paths: HomePaths): () => void {
  const lock = join(paths.root, "pispark.lock");
  const token = randomUUID();
  const acquire = () => {
    const fd = openSync(lock, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
    } finally {
      closeSync(fd);
    }
  };
  const ownerAlive = () => {
    try {
      const { pid } = JSON.parse(readFileSync(lock, "utf8")) as { pid: number };
      if (!Number.isSafeInteger(pid) || pid < 1) return false;
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  };
  try {
    acquire();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (ownerAlive())
      throw new Error(
        `Another PiSpark server is using ${paths.root}. Stop it or set PISPARK_HOME to another folder.`,
      );
    unlinkSync(lock);
    acquire();
  }
  return () => {
    try {
      const owner = JSON.parse(readFileSync(lock, "utf8")) as { token: string };
      if (owner.token === token) unlinkSync(lock);
    } catch {
      /* Already gone. */
    }
  };
}
