import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../files.js";

interface File {
  version: 1;
  /** The number the next handle gets. */
  next: number;
  /** Each thing the session started, by its real id. */
  names: Record<string, string>;
}

/**
 * Short names for what a session started: its kind and a number, such as `session-1` or
 * `process-3`. A handle is unique within the session that started the thing, which is enough
 * because the verbs act only on that; the real ids stay inside PiSpark. Kept in the session's
 * `handles.json`, so a handle means the same thing after a restart.
 */
export class Handles {
  private readonly files = new Map<string, File>();

  constructor(private readonly directory: (sessionId: string) => string) {}

  /** The handle of something `owner` started, given the first time it is asked for. */
  of(owner: string, kind: string, id: string): string {
    const file = this.file(owner);
    const known = file.names[id];
    if (known) return known;
    const handle = `${kind}-${file.next++}`;
    file.names[id] = handle;
    this.save(owner, file);
    return handle;
  }

  /** What a handle names, if `owner` was given it. */
  find(owner: string, handle: string): { kind: string; id: string } | undefined {
    const id = Object.entries(this.file(owner).names).find(([, name]) => name === handle)?.[0];
    return id ? { kind: handle.slice(0, handle.lastIndexOf("-")), id } : undefined;
  }

  /** The session is gone. */
  forget(owner: string): void {
    this.files.delete(owner);
  }

  private file(owner: string): File {
    let file = this.files.get(owner);
    if (!file) {
      file = { version: 1, next: 1, names: {} };
      const path = join(this.directory(owner), "handles.json");
      try {
        const read = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as File) : undefined;
        if (read?.version === 1 && Number.isSafeInteger(read.next) && read.next > 0 && read.names && typeof read.names === "object") file = read;
      } catch {
        /* Unreadable: handles are given anew. */
      }
      this.files.set(owner, file);
    }
    return file;
  }

  private save(owner: string, file: File): void {
    const directory = this.directory(owner);
    if (!existsSync(directory)) return;
    try {
      writeAtomic(join(directory, "handles.json"), JSON.stringify(file, null, 2) + "\n");
    } catch {
      /* Kept in memory; given again after a restart. */
    }
  }
}
