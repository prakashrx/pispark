import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_CHANNELS, compareVersions, type ReleaseChannel } from "../../server/src/contract/host-protocol.ts";

/** Bumped when the launcher changes; a release whose launcher differs switches launchers too. */
export const LAUNCHER_VERSION = 1;
export const windows = process.platform === "win32";
export const VERSION = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
/** An install's name: lowercase letters, digits and dashes. */
export const NAME = /^[a-z0-9][a-z0-9-]{0,19}$/;

/** How an install is called on the machine: the main one "PiSpark", a named one "PiSpark (dev)". */
export function identity(name?: string) {
  return {
    label: name ? `PiSpark (${name})` : "PiSpark",
    run: name ? `PiSpark-${name}` : "PiSpark",
    unit: name ? `pispark-${name}.service` : "pispark.service",
    command: name ? `pispark-${name}` : "pispark",
  };
}

/** `release.json`: what a release folder is. */
export interface ReleaseInfo {
  version: string;
  channel: ReleaseChannel;
  launcher: number;
  os: "win" | "linux";
  arch: "x64" | "arm64";
  node: string;
  commit?: string;
}

/** A release folder: everything one version needs (its Node, the app, the launcher). */
export class Release {
  constructor(
    readonly dir: string,
    readonly info: ReleaseInfo,
  ) {}
  static at(dir: string): Release {
    return new Release(dir, JSON.parse(readFileSync(join(dir, "release.json"), "utf8")) as ReleaseInfo);
  }
  get node() {
    return windows ? join(this.dir, "node", "node.exe") : join(this.dir, "node", "bin", "node");
  }
  /** Windows: the same Node marked as a windowed program, so it runs without a console. */
  get windowless() {
    return windows ? join(this.dir, "node", "pispark.exe") : this.node;
  }
  get launcher() {
    return join(this.dir, "app", "apps", "launcher", "dist", "pispark.mjs");
  }
  get server() {
    return join(this.dir, "app", "apps", "server", "dist", "index.js");
  }
  get tray() {
    return join(this.dir, "app", "apps", "launcher", "dist", "tray.ps1");
  }
  get icon() {
    return join(this.dir, "app", "apps", "launcher", "dist", "pispark.ico");
  }
}

/**
 * Windows: makes `node/pispark.exe`, a copy of the release's Node with its header's subsystem set to
 * windowed (2), so Windows opens no console for it. Made on the machine (at setup and after each
 * download) rather than shipped, which keeps the download one Node smaller.
 */
export function ensureWindowless(release: Release) {
  if (!windows || existsSync(release.windowless)) return;
  const exe = readFileSync(release.node);
  const pe = exe.length >= 0x40 ? exe.readUInt32LE(0x3c) : -1;
  if (pe < 0 || pe + 24 + 70 > exe.length || exe.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error(`${release.node} is not a Windows program`);
  exe.writeUInt16LE(2, pe + 24 + 68);
  writeAtomic(release.windowless, exe);
}

/** The release this launcher runs from: the folder with `release.json` four levels above it. */
export function ownRelease(file = fileURLToPath(import.meta.url)): Release | undefined {
  const dir = resolve(dirname(realpathSync(file)), "../../../..");
  return existsSync(join(dir, "release.json")) ? Release.at(dir) : undefined;
}

/** What the person chose; written by `setup` and Settings → About. */
export interface Choices {
  channel: ReleaseChannel;
  port: number;
  autoUpdate: boolean;
  /** A data folder other than `~/.pispark`. */
  home?: string;
  /** A named install (`dev`, `test`) beside the main one: its own login entry, service and command. */
  name?: string;
  /** Kept at this version: no update checks until resumed. */
  kept?: string;
  /** Where releases are listed, if not this repository's GitHub Releases (a mirror, or a test feed). */
  releases?: string;
}

/**
 * The install folder: `versions/<version>/`, `current` (a link to the running version: a junction on
 * Windows, a symlink on Linux), `state.json`, `update/` (the handover files `pispark-start` also
 * reads on Linux) and `logs/`. Never holds the person's data.
 */
export class Install {
  readonly versions: string;
  readonly current: string;
  readonly logs: string;
  readonly update: string;
  readonly downloads: string;
  private readonly stateFile: string;
  constructor(readonly root: string) {
    this.versions = join(root, "versions");
    this.current = join(root, "current");
    this.logs = join(root, "logs");
    this.update = join(root, "update");
    this.downloads = join(root, "downloads");
    this.stateFile = join(root, "state.json");
  }
  /** The install a release folder belongs to: `<root>/versions/<version>`. */
  static of(release: Release): Install | undefined {
    const versions = dirname(release.dir);
    return basename(versions) === "versions" ? new Install(dirname(versions)) : undefined;
  }
  release(version: string) {
    return join(this.versions, version);
  }
  /** Installed versions, oldest first. */
  installed(): string[] {
    if (!existsSync(this.versions)) return [];
    return readdirSync(this.versions)
      .filter((v) => existsSync(join(this.versions, v, "release.json")))
      .sort(compareVersions);
  }
  currentVersion(): string | undefined {
    try {
      return basename(realpathSync(this.current));
    } catch {
      return undefined;
    }
  }
  /** Points `current` at a version. */
  point(version: string) {
    const target = this.release(version);
    if (!existsSync(join(target, "release.json"))) throw new Error(`${version} is not installed`);
    if (windows) {
      // A junction needs no admin rights. Removing it removes only the link, never what it points to.
      if (isLink(this.current)) unlinkSync(this.current);
      symlinkSync(target, this.current, "junction");
    } else {
      // Relative, so pispark-start reads the same link; renamed into place in one step.
      const next = `${this.current}.next`;
      rmSync(next, { force: true });
      symlinkSync(join("versions", version), next);
      renameSync(next, this.current);
    }
  }
  choices(): Choices {
    const fallback: Choices = { channel: "stable", port: 3000, autoUpdate: false };
    try {
      const saved = JSON.parse(readFileSync(this.stateFile, "utf8")) as Partial<Choices>;
      return {
        channel: RELEASE_CHANNELS.includes(saved.channel as ReleaseChannel) ? (saved.channel as ReleaseChannel) : fallback.channel,
        port: Number.isInteger(saved.port) && saved.port! > 0 && saved.port! < 65536 ? saved.port! : fallback.port,
        autoUpdate: saved.autoUpdate === true,
        ...(typeof saved.home === "string" && saved.home ? { home: saved.home } : {}),
        ...(typeof saved.kept === "string" && VERSION.test(saved.kept) ? { kept: saved.kept } : {}),
        ...(typeof saved.name === "string" && NAME.test(saved.name) ? { name: saved.name } : {}),
        ...(typeof saved.releases === "string" && /^https?:\/\//.test(saved.releases) ? { releases: saved.releases } : {}),
      };
    } catch {
      return fallback;
    }
  }
  choose(change: Partial<Choices>): Choices {
    const next = { ...this.choices(), ...change };
    writeAtomic(this.stateFile, JSON.stringify(next, null, 2) + "\n");
    return next;
  }
  /** Versions that failed to start; never offered again. */
  failed(): string[] {
    return this.readLines("failed");
  }
  /** Asked for by name: no longer counted as failed. */
  unmarkFailed(version: string) {
    if (this.failed().includes(version)) this.writeLines("failed", this.failed().filter((v) => v !== version));
  }
  markFailed(version: string) {
    if (!this.failed().includes(version)) this.writeLines("failed", [...this.failed(), version]);
  }
  /** Linux handover: the version being tried, and the one to go back to. */
  trying(): { version: string; previous: string } | undefined {
    const [version] = this.readLines("trying");
    const [previous] = this.readLines("previous");
    return version && previous ? { version, previous } : undefined;
  }
  startTrying(version: string, previous: string) {
    this.writeLines("previous", [previous]);
    this.writeLines("trying", [version]);
    rmSync(join(this.update, "trying.started"), { force: true });
  }
  /** The new version is healthy: nothing to roll back. */
  confirm() {
    for (const f of ["trying", "trying.started"]) rmSync(join(this.update, f), { force: true });
  }
  remove(version: string) {
    rmSync(this.release(version), { recursive: true, force: true });
  }
  /**
   * Removes versions beyond the newest two, never the running one or one a running launcher was
   * started from (passed in `keep`).
   */
  prune(keep: string[]) {
    const all = this.installed();
    const newest = all.slice(-2);
    for (const v of all) if (!newest.includes(v) && !keep.includes(v)) rmSync(this.release(v), { recursive: true, force: true });
  }
  private readLines(name: string): string[] {
    try {
      return readFileSync(join(this.update, name), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  private writeLines(name: string, lines: string[]) {
    mkdirSync(this.update, { recursive: true });
    writeAtomic(join(this.update, name), lines.join("\n") + "\n");
  }
}

export function isLink(path: string) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function writeAtomic(file: string, text: string | Buffer) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}
