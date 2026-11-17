import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { RuntimeError } from "./errors.js";
import { validChoice } from "./provider-storage.js";
import type { ModelChoice } from "../../contract/provider-protocol.js";
import { validSessionTitle } from "../../contract/session-title.js";
import { validAgentId } from "../agents/format.js";
import { validReportMode, type ReportMode } from "../../contract/wake-protocol.js";

/** `session.json`: what PiSpark knows about a session. Pi's JSONL beside it is the transcript. */
export interface SessionMetadata {
  version: 2;
  id: string;
  cwd: string;
  agent: string;
  model?: ModelChoice;
  createdAt: string;
  title?: string;
  /** A run was in progress; set before model or tool side effects. */
  active: boolean;
  interrupted: boolean;
  /** Setup fingerprint when the session last started. */
  setup?: string;
  /** A prompt waiting for a run slot, kept so a restart does not lose it. */
  queued?: string;
  /** Put away by the person: not listed or opened until restored. */
  archived?: true;
  /** The session that started this one (a child session); its runs report back to it. */
  parent?: string;
  /** How it tells its parent when a run ends; `result` when not given. */
  report?: ReportMode;
  /** The schedule or app routine this session is one run of, and when that run was due. */
  schedule?: { id: string; due: string };
  /** An extension keeps it loaded while no one watches (`pispark:hold`), and why. */
  held?: { extension: string; reason: string };
}

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validateId(id: string): void {
  if (typeof id !== "string" || !UUID.test(id))
    throw new RuntimeError("invalid-input");
}

/** `<home>/sessions/<id>/`. The session ID is the folder name and is not repeated in session.json. */
export class SessionStorage {
  readonly root: string;
  private catalog = new Map<string, SessionMetadata>();
  private rescanAt = 0;
  /** When each session last did something (ms), from its transcript or its running session; cleared on rescan. */
  private readonly activity = new Map<string, number>();
  unreadable = 0;
  constructor(root: string) {
    this.root = resolve(root);
    try {
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
    } catch {
      throw new RuntimeError("storage");
    }
  }
  directory(id: string): string {
    validateId(id);
    return join(this.root, id);
  }
  prepare(id: string): string {
    const dir = this.directory(id);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (lstatSync(dir).isSymbolicLink()) throw new Error();
      return dir;
    } catch {
      throw new RuntimeError("storage");
    }
  }
  read(id: string): SessionMetadata {
    try {
      const value = JSON.parse(
        readFileSync(join(this.directory(id), "session.json"), "utf8"),
      ) as Omit<SessionMetadata, "id">;
      if (
        value.version !== 2 ||
        typeof value.cwd !== "string" ||
        !validAgentId(value.agent) ||
        (value.model !== undefined && !validChoice(value.model)) ||
        typeof value.createdAt !== "string" ||
        (value.title !== undefined && !validSessionTitle(value.title)) ||
        typeof value.active !== "boolean" ||
        typeof value.interrupted !== "boolean" ||
        (value.setup !== undefined && !/^[a-f0-9]{64}$/.test(value.setup)) ||
        (value.queued !== undefined && (typeof value.queued !== "string" || value.queued.length > 64 * 1024)) ||
        (value.archived !== undefined && value.archived !== true) ||
        (value.parent !== undefined && (typeof value.parent !== "string" || !UUID.test(value.parent))) ||
        (value.report !== undefined && (value.report as unknown) !== false && !validReportMode(value.report)) ||
        (value.schedule !== undefined &&
          (!value.schedule ||
            typeof value.schedule.id !== "string" ||
            !value.schedule.id ||
            value.schedule.id.length > 200 ||
            typeof value.schedule.due !== "string" ||
            Number.isNaN(new Date(value.schedule.due).getTime()))) ||
        (value.held !== undefined &&
          (!value.held || typeof value.held.extension !== "string" || typeof value.held.reason !== "string" || value.held.reason.length > 200))
      )
        throw new Error();
      // `report: false` was the first form of `none`.
      const report = (value.report as unknown) === false ? { report: "none" as const } : {};
      return { ...value, ...report, id };
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new RuntimeError("not-found");
      throw new RuntimeError("storage");
    }
  }
  write(metadata: SessionMetadata): void {
    const dir = this.prepare(metadata.id);
    const temporary = join(dir, `.session-${randomUUID()}.tmp`);
    const { id: _id, ...stored } = metadata;
    try {
      writeFileSync(temporary, JSON.stringify(stored, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporary, join(dir, "session.json"));
      this.catalog.set(metadata.id, structuredClone(metadata));
    } catch {
      try {
        unlinkSync(temporary);
      } catch {
        /* The write error is what matters. */
      }
      throw new RuntimeError("storage");
    }
  }
  list(): SessionMetadata[] {
    try {
      if (Date.now() >= this.rescanAt) {
        const entries = new Map<string, SessionMetadata>();
        let unreadable = 0;
        for (const id of readdirSync(this.root)) {
          if (!UUID.test(id)) continue;
          try {
            entries.set(id, this.read(id));
          } catch (error) {
            if (!(error instanceof RuntimeError && error.code === "not-found"))
              unreadable++;
          }
        }
        this.catalog = entries;
        this.activity.clear();
        this.unreadable = unreadable;
        // Local writes update the cache immediately; pick up outside edits every 30s.
        this.rescanAt = Date.now() + 30_000;
      }
      return Array.from(this.catalog.values(), (entry) => structuredClone(entry));
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("storage");
    }
  }
  /** The session folders there are, by name; nothing is read or cached. */
  ids(): string[] {
    try {
      return readdirSync(this.root).filter((id) => UUID.test(id));
    } catch {
      return [];
    }
  }
  /** Removes a session for good: its folder holds everything about it (session.json, Pi's transcript, its agent layer). */
  remove(id: string): void {
    const dir = this.directory(id);
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      throw new RuntimeError("storage");
    }
    this.catalog.delete(id);
    this.activity.delete(id);
  }
  /** Remove a session folder that never got a session.json (a failed first start). */
  discardUnpublished(id: string): void {
    const dir = this.directory(id);
    if (!existsSync(join(dir, "session.json")))
      rmSync(dir, { recursive: true, force: true });
  }
  /** Pi names the transcript `<time>_<id>.jsonl`; it's the only such file in the folder. */
  transcript(id: string): string | undefined {
    const dir = this.directory(id);
    if (!existsSync(dir)) return undefined;
    const file = readdirSync(dir).find((name) => name.endsWith(`_${id}.jsonl`));
    return file ? join(dir, file) : undefined;
  }
  /**
   * When the session last did something: Pi writes every entry to the transcript as it happens, so its
   * last write; when it started if it has no history. Read once, then kept until the next rescan.
   */
  lastActivity(metadata: SessionMetadata): string {
    let at = this.activity.get(metadata.id);
    if (at === undefined) {
      const path = this.transcript(metadata.id);
      try {
        at = path ? statSync(path).mtimeMs : 0;
      } catch {
        at = 0;
      }
      this.activity.set(metadata.id, at);
    }
    const created = Date.parse(metadata.createdAt);
    return at > created ? new Date(at).toISOString() : metadata.createdAt;
  }
  /** A running session added to its history just now. */
  active(id: string): void {
    this.activity.set(id, Date.now());
  }
  hasHistory(id: string): boolean {
    return this.transcript(id) !== undefined;
  }
  /** Pi skips malformed lines; refuse a corrupted transcript rather than silently lose history. */
  validateHistory(metadata: SessionMetadata): string | undefined {
    const path = this.transcript(metadata.id);
    if (!path) return undefined;
    try {
      if (lstatSync(path).isSymbolicLink() || statSync(path).size > 64 * 1024 * 1024)
        throw new Error();
      const lines = readFileSync(path, "utf8").trim().split("\n");
      const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const header = entries[0];
      if (
        header?.type !== "session" ||
        header.id !== metadata.id ||
        header.version !== 3
      )
        throw new Error();
      return path;
    } catch {
      throw new RuntimeError("storage");
    }
  }
}
