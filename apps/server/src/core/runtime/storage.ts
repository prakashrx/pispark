import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "../../contract/agent-protocol.js";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { RuntimeError } from "./errors.js";
import { writeAtomic } from "../files.js";
import { validChoice } from "./provider-storage.js";
import type { ModelChoice } from "../../contract/provider-protocol.js";
import { validSessionTitle } from "../../contract/session-title.js";
import { validAgentId } from "../agents/format.js";
import { validChildReportMode, type ChildReportMode } from "../../contract/wake-protocol.js";

/** `session.json`: what PiSpark knows about a session. Pi's JSONL beside it is the transcript. */
export interface SessionMetadata {
  version: 2;
  id: string;
  cwd: string;
  agent: string;
  model?: ModelChoice;
  createdAt: string;
  title?: string;
  /** A person named the session: the agent's title tool no longer changes it. */
  renamed?: true;
  /** The thinking level chosen for this session, over its agent's. */
  thinking?: ThinkingLevel;
  /** When a person last looked at it (any device); newer activity makes it unread. */
  seenAt?: string;
  /** A run was in progress; set before model or tool side effects. */
  active: boolean;
  interrupted: boolean;
  /** Setup fingerprint when the session last started. */
  setup?: string;
  /** A prompt waiting for a run slot, kept so a restart does not lose it. */
  queued?: string;
  /** Put away by the person: not listed or opened until restored. */
  archived?: true;
  /** Uploads have been recorded from this session’s creation. */
  tracksUploads?: true;
  /** The session that started this one (a child session); its runs report back to it. */
  parent?: string;
  /** Source of a manual fork, for navigation only. */
  forkOf?: string;
  /**
   * An ask its parent made that it has not answered yet, and where in its transcript the ask
   * began. Its parent hears once per ask, when the child is at rest (see `Children`).
   */
  ask?: { from: number };
  /** How it tells its parent when a run ends; `result` when not given. */
  report?: ChildReportMode;
  /** The schedule or app routine this session is one run of, and when that run was due. */
  schedule?: { id: string; due: string };
  /** An extension keeps it loaded while no one watches (`pispark:hold`), and why. */
  held?: { extension: string; reason: string };
}

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
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
        (value.renamed !== undefined && value.renamed !== true) ||
        (value.thinking !== undefined && !THINKING_LEVELS.includes(value.thinking)) ||
        (value.seenAt !== undefined && (typeof value.seenAt !== "string" || Number.isNaN(Date.parse(value.seenAt)))) ||
        typeof value.active !== "boolean" ||
        typeof value.interrupted !== "boolean" ||
        (value.setup !== undefined && !/^[a-f0-9]{64}$/.test(value.setup)) ||
        (value.queued !== undefined && (typeof value.queued !== "string" || value.queued.length > 64 * 1024)) ||
        (value.archived !== undefined && value.archived !== true) ||
        (value.forkOf !== undefined && (typeof value.forkOf !== "string" || !UUID.test(value.forkOf) || value.forkOf === id)) ||
        (value.parent !== undefined && (typeof value.parent !== "string" || !UUID.test(value.parent))) ||
        (value.report !== undefined && (value.report as unknown) !== false && !validChildReportMode(value.report)) ||
        (value.ask !== undefined && (!value.ask || !Number.isSafeInteger(value.ask.from) || value.ask.from < 0)) ||
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
      // The agent page's Agent Builder sessions (`edits`, `context`) were once hidden from the list; now they're ordinary sessions.
      const { edits: _edits, context: _context, ...kept } = value as SessionMetadata & { edits?: unknown; context?: unknown };
      return { ...kept, ...report, id };
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new RuntimeError("not-found");
      throw new RuntimeError("storage");
    }
  }
  write(metadata: SessionMetadata): void {
    const dir = this.prepare(metadata.id);
    const { id: _id, ...stored } = metadata;
    try {
      writeAtomic(join(dir, "session.json"), JSON.stringify(stored, null, 2) + "\n");
      this.catalog.set(metadata.id, structuredClone(metadata));
    } catch {
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
  /** Materialize Pi's buffered entries when a host status must outlive an empty conversation. */
  persistStatusHistory(manager: SessionManager): void {
    const file = manager.getSessionFile();
    const header = manager.getHeader();
    if (!file || !header) throw new RuntimeError("storage");
    if (existsSync(file)) return;
    const entries = [header, ...manager.getEntries()];
    writeAtomic(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    manager.setSessionFile(file);
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
