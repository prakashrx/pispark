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
import type { ModelChoice } from "../provider-protocol.js";
import { validChatTitle } from "./chat-title.js";
import { validPersonaId } from "../personas/format.js";

/** `chat.json`: what PiSpark knows about a chat. Pi's JSONL beside it is the transcript. */
export interface ChatMetadata {
  version: 2;
  id: string;
  cwd: string;
  persona: string;
  model?: ModelChoice;
  createdAt: string;
  title?: string;
  /** A run was in progress; set before model or tool side effects. */
  active: boolean;
  interrupted: boolean;
  /** Setup fingerprint when the session last started. */
  setup?: string;
}

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validateId(id: string): void {
  if (typeof id !== "string" || !UUID.test(id))
    throw new RuntimeError("invalid-input");
}

/** `<home>/chats/<id>/`. The chat ID is the folder name and is not repeated in chat.json. */
export class ChatStorage {
  readonly root: string;
  private catalog = new Map<string, ChatMetadata>();
  private rescanAt = 0;
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
  read(id: string): ChatMetadata {
    try {
      const value = JSON.parse(
        readFileSync(join(this.directory(id), "chat.json"), "utf8"),
      ) as Omit<ChatMetadata, "id">;
      if (
        value.version !== 2 ||
        typeof value.cwd !== "string" ||
        !validPersonaId(value.persona) ||
        (value.model !== undefined && !validChoice(value.model)) ||
        typeof value.createdAt !== "string" ||
        (value.title !== undefined && !validChatTitle(value.title)) ||
        typeof value.active !== "boolean" ||
        typeof value.interrupted !== "boolean" ||
        (value.setup !== undefined && !/^[a-f0-9]{64}$/.test(value.setup))
      )
        throw new Error();
      return { ...value, id };
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new RuntimeError("not-found");
      throw new RuntimeError("storage");
    }
  }
  write(metadata: ChatMetadata): void {
    const dir = this.prepare(metadata.id);
    const temporary = join(dir, `.chat-${randomUUID()}.tmp`);
    const { id: _id, ...stored } = metadata;
    try {
      writeFileSync(temporary, JSON.stringify(stored, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporary, join(dir, "chat.json"));
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
  list(): ChatMetadata[] {
    try {
      if (Date.now() >= this.rescanAt) {
        const entries = new Map<string, ChatMetadata>();
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
  /** Remove a chat folder that never got a chat.json (a failed first start). */
  discardUnpublished(id: string): void {
    const dir = this.directory(id);
    if (!existsSync(join(dir, "chat.json")))
      rmSync(dir, { recursive: true, force: true });
  }
  /** Pi names the transcript `<time>_<id>.jsonl`; it's the only such file in the folder. */
  transcript(id: string): string | undefined {
    const dir = this.directory(id);
    if (!existsSync(dir)) return undefined;
    const file = readdirSync(dir).find((name) => name.endsWith(`_${id}.jsonl`));
    return file ? join(dir, file) : undefined;
  }
  hasHistory(id: string): boolean {
    return this.transcript(id) !== undefined;
  }
  /** Pi skips malformed lines; refuse a corrupted transcript rather than silently lose history. */
  validateHistory(metadata: ChatMetadata): string | undefined {
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
