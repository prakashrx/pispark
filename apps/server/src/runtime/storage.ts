import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
  readdirSync,
  lstatSync,
  statSync,
  rmSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { RuntimeError } from "./errors.js";
import { validChoice } from "./provider-storage.js";
import type { ModelChoice } from "../provider-protocol.js";
import {
  validAdmissionMetadata,
  type PersonaAdmissionMetadata,
} from "../personas/admission.js";

import { validChatTitle } from "./chat-title.js";

export interface SessionMetadata {
  version: 1;
  id: string;
  workspace: string;
  configuration: string;
  model?: ModelChoice;
  persona?: PersonaAdmissionMetadata;
  cwd: string;
  createdAt: string;
  title?: string;
  nativeFile: string;
  active: boolean;
  hasHistory: boolean;
  interrupted: boolean;
}

export function validateId(id: string): void {
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    )
  )
    throw new RuntimeError("invalid-input");
}

/** Host metadata only. Pi JSONL remains the sole transcript store. Dedicated trusted local directory. */
export class SessionStorage {
  readonly root: string;
  private catalog = new Map<string, SessionMetadata>();
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
  read(id: string): SessionMetadata {
    try {
      const value = JSON.parse(
        readFileSync(join(this.directory(id), "host.json"), "utf8"),
      ) as SessionMetadata;
      if (value.persona !== undefined && !validAdmissionMetadata(value.persona))
        throw new RuntimeError("resource-integrity");
      if (
        (value.title !== undefined && !validChatTitle(value.title)) ||
        value.version !== 1 ||
        value.id !== id ||
        typeof value.workspace !== "string" ||
        typeof value.configuration !== "string" ||
        (value.model !== undefined && !validChoice(value.model)) ||
        typeof value.cwd !== "string" ||
        typeof value.createdAt !== "string" ||
        typeof value.nativeFile !== "string" ||
        basename(value.nativeFile) !== value.nativeFile ||
        !value.nativeFile.endsWith(`_${id}.jsonl`) ||
        typeof value.active !== "boolean" ||
        typeof value.hasHistory !== "boolean" ||
        typeof value.interrupted !== "boolean"
      )
        throw new Error();
      return value;
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new RuntimeError("not-found");
      throw new RuntimeError("storage");
    }
  }
  write(metadata: SessionMetadata): void {
    const dir = this.directory(metadata.id);
    const temporary = join(dir, `host-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify(metadata), {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporary, join(dir, "host.json"));
      this.catalog.set(metadata.id, structuredClone(metadata));
    } catch {
      try {
        unlinkSync(temporary);
      } catch {
        /* Original write failure is authoritative. */
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
          if (!/^[a-f0-9-]{36}$/.test(id)) continue;
          try {
            entries.set(id, this.read(id));
          } catch (error) {
            if (!(error instanceof RuntimeError && error.code === "not-found")) unreadable++;
          }
        }
        this.catalog = entries;
        this.unreadable = unreadable;
        // Local writes update the cache immediately. Reconcile external edits once per host.
        this.rescanAt = Date.now() + 30_000;
      }
      return Array.from(this.catalog.values());
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("storage");
    }
  }
  discardUnpublished(id: string): void {
    const dir = this.directory(id);
    if (!existsSync(join(dir, "host.json"))) rmSync(dir, { recursive: true, force: true });
  }
  nativePath(metadata: SessionMetadata): string {
    return join(this.directory(metadata.id), metadata.nativeFile);
  }
  validateHistory(metadata: SessionMetadata): boolean {
    const path = this.nativePath(metadata);
    try {
      if (!existsSync(path)) {
        if (metadata.hasHistory) throw new Error();
        return false;
      }
      if (
        lstatSync(path).isSymbolicLink() ||
        statSync(path).size > 64 * 1024 * 1024
      )
        throw new Error();
      const lines = readFileSync(path, "utf8").trim().split("\n");
      // Pi skips malformed lines; refuse corruption rather than silently lose finalized history.
      const entries = lines.map(
        (line) => JSON.parse(line) as Record<string, unknown>,
      );
      const header = entries[0];
      if (
        header?.type !== "session" ||
        header.id !== metadata.id ||
        header.cwd !== metadata.cwd ||
        header.version !== 3
      )
        throw new Error();
      return true;
    } catch {
      throw new RuntimeError("storage");
    }
  }
  claim(id: string): () => void {
    const dir = this.prepare(id);
    const lock = join(dir, "owner.lock");
    const recovery = join(dir, "owner-recovery");
    const token = randomUUID();
    const acquire = () => {
      const fd = openSync(lock, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      } finally {
        closeSync(fd);
      }
    };
    const isDead = () => {
      const owner = JSON.parse(readFileSync(lock, "utf8")) as { pid: number };
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) return false;
      try {
        process.kill(owner.pid, 0);
        return false;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ESRCH";
      }
    };
    try {
      if (existsSync(recovery)) throw new RuntimeError("owned");
      try {
        acquire();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (!isDead()) throw new RuntimeError("owned");
        // Serialize stale-owner recovery, then re-read: never remove a replacement owner's lock.
        try {
          mkdirSync(recovery);
        } catch {
          throw new RuntimeError("owned");
        }
        try {
          if (!isDead()) throw new RuntimeError("owned");
          unlinkSync(lock);
          acquire();
        } finally {
          rmdirSync(recovery);
        }
      }
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("storage");
    }
    return () => {
      try {
        const owner = JSON.parse(readFileSync(lock, "utf8")) as {
          token: string;
        };
        if (owner.token !== token) throw new Error();
        unlinkSync(lock);
      } catch {
        throw new RuntimeError("storage");
      }
    };
  }
}
