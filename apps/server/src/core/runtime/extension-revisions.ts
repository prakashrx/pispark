import { prepareDependencies } from "./extension-dependencies.js";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

import { writeAtomic } from "../files.js";

const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const LIMIT = 2 * 1024 * 1024;
const ENTRY = /^(?:index\.)?(?:.+\.)?(?:ts|js|mjs|mts)$/;
const FILE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
export const extensionNameValid = (value: unknown): value is string => typeof value === "string" && NAME.test(value);
const hashValid = (value: unknown): value is string => typeof value === "string" && HASH.test(value);

type Snapshot = { entry: string; files: Map<string, Buffer>; hash: string };
export type ExtensionChange = { name: string; revision: string; snapshot?: string; entry?: string; source?: string; scope?: "session" };
export type ExtensionState = { active: ExtensionChange[]; staged?: ExtensionChange; outcome?: string };

function snapshot(source: string, savedEntry?: string): Snapshot {
  const files = new Map<string, Buffer>();
  let remaining = LIMIT;
  function visit(path: string, key: string, depth: number) {
    if (depth > 12 || realpathSync(path) !== path) throw new Error("Links and deeply nested sources are not supported.");
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      const children = readdirSync(path).sort();
      if (children.length > 128) throw new Error("Extension folder has too many entries.");
      for (const child of children) {
        if (!FILE.test(child) || child.endsWith(".") || /^(?:node_modules|con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(child))
          throw new Error("Use a self-contained extension folder without hidden files, dependencies or special names.");
        visit(join(path, child), key ? `${key}/${child}` : child, depth + 1);
      }
      return;
    }
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > remaining || files.size >= 128)
      throw new Error("Use regular, unlinked files (up to 128 files and 2 MiB total).");
    const fd = openSync(path, "r");
    try {
      const opened = fstatSync(fd);
      if (opened.ino !== stat.ino || opened.dev !== stat.dev || !opened.isFile() || opened.nlink !== 1)
        throw new Error("Source changed while staging.");
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = readSync(fd, bytes, length, bytes.length - length, null);
        if (!count) break;
        length += count;
      }
      const after = fstatSync(fd);
      if (length !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || realpathSync(path) !== path)
        throw new Error("Source changed while staging.");
      remaining -= length;
      files.set(key || basename(path), bytes.subarray(0, length));
    } finally { closeSync(fd); }
  }
  const folder = lstatSync(source).isDirectory();
  visit(source, "", 0);
  const entries = savedEntry ? [savedEntry] : folder ? ["index.ts", "index.js", "index.mjs", "index.mts"].filter((entry) => files.has(entry)) : [basename(source)];
  if (entries.length !== 1 || !files.has(entries[0]!) || !FILE.test(entries[0]!) || !ENTRY.test(entries[0]!))
    throw new Error("Give a Pi extension file or a folder with exactly one index.ts, index.js, index.mjs or index.mts.");
  const entry = entries[0]!;
  const hash = createHash("sha256");
  hash.update(JSON.stringify(entry));
  for (const [key, bytes] of files) hash.update(JSON.stringify([key, bytes.length])).update(bytes);
  return { entry, files, hash: hash.digest("hex") };
}

/** Host-owned snapshots are not in any Pi discovery folder. Only the active selector feeds Pi. */
export class ExtensionRevisions {
  constructor(private readonly root: string) {}
  read(): ExtensionState {
    try {
      const state = JSON.parse(readFileSync(join(this.root, "state.json"), "utf8")) as ExtensionState;
      const valid = (change: ExtensionChange) => extensionNameValid(change.name) && hashValid(change.revision) &&
        (change.scope === undefined || change.scope === "session") &&
        (change.snapshot === undefined ? change.entry === undefined : hashValid(change.snapshot) && typeof change.entry === "string" && FILE.test(change.entry) && ENTRY.test(change.entry));
      if (!Array.isArray(state.active) || state.active.length > 16 || !state.active.every((change) => valid(change) && change.snapshot) || (state.staged && !valid(state.staged)))
        throw new Error("Invalid session extension state.");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { active: [] };
      throw error;
    }
  }
  write(state: ExtensionState): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeAtomic(join(this.root, "state.json"), JSON.stringify(state));
  }
  path(change: ExtensionChange): string {
    return join(this.root, change.snapshot!, change.entry!);
  }
  loadPath(change: ExtensionChange): string {
    const prepared = join(this.root, "prepared", change.snapshot!, change.entry!);
    return existsSync(prepared) ? prepared : this.path(change);
  }
  async prepare(change: ExtensionChange): Promise<void> {
    if (!change.snapshot) return;
    await prepareDependencies(dirname(this.path(change)), join(this.root, "prepared", change.snapshot));
  }
  stage(cwd: string, name: string, source?: string, sessionRoot?: string): ExtensionChange {
    const state = this.read();
    if (!extensionNameValid(name)) throw new Error("Give a lowercase extension name (letters, digits and hyphens).");
    const prior = state.active.find((change) => change.name === name);
    if (!source && !prior) throw new Error("Only extensions installed by this tool in this session can be removed.");
    if (source && !prior && state.active.length >= 16) throw new Error("Session extension limit reached.");
    let change: ExtensionChange;
    if (source) {
      const parts = source.split(/[/\\]/);
      if (source.length > 1024 || isAbsolute(source) || !parts.every((part) => FILE.test(part) && !part.endsWith(".")))
        throw new Error("Give a relative path inside the session checkout, without dot segments.");
      const root = realpathSync(cwd);
      if (sessionRoot && root !== join(realpathSync(sessionRoot), "extension-drafts"))
        throw new Error("Use the session's own extension-drafts directory without links.");
      const path = join(root, ...parts);
      if (relative(root, path).startsWith(`..${sep}`) || realpathSync(path) !== path)
        throw new Error("Source must be inside the session checkout and must not traverse links.");
      const copy = snapshot(path);
      const destination = join(this.root, copy.hash);
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      const temp = join(this.root, `.snapshot-${randomUUID()}`);
      try {
        for (const [key, bytes] of copy.files) {
          const file = join(temp, key);
          mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
          writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
        }
        try { renameSync(temp, destination); }
        catch (error) {
          if (snapshot(destination, copy.entry).hash !== copy.hash) throw error;
        }
      } finally { rmSync(temp, { recursive: true, force: true }); }
      change = { name, ...(sessionRoot ? { scope: "session" } : {}), source: sessionRoot ? `extension-drafts/${source}` : source, entry: copy.entry, snapshot: copy.hash, revision: randomRevision(name, copy.hash) };
    } else change = { name, revision: randomRevision(name, prior!.snapshot!) };
    this.write({ ...state, staged: change });
    this.prune(state.staged?.snapshot);
    return change;
  }
  verify(change: ExtensionChange): void {
    if (!change.snapshot) return;
    const copy = snapshot(dirname(this.path(change)), change.entry);
    if (copy.hash !== change.snapshot || copy.entry !== change.entry) throw new Error("The staged files changed; stage them again.");
  }
  prune(hash?: string): void {
    if (!hash) return;
    const state = this.read();
    if (state.staged?.snapshot !== hash && !state.active.some((change) => change.snapshot === hash)) {
      for (const folder of [join(this.root, hash), join(this.root, "prepared", hash)]) {
        try { rmSync(folder, { recursive: true, force: true }); } catch { /* A retained snapshot is harmless. */ }
      }
    }
  }
}

const randomRevision = (name: string, hash: string) => createHash("sha256").update(`${name}:${hash}:${randomUUID()}`).digest("hex");
