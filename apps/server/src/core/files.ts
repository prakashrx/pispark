import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** Whether `path` is `root` or inside it. A name that only starts with two dots (`..notes`) is inside. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** The file system a save uses; tests stand in for it. */
interface FileSystem {
  rename?: (from: string, to: string) => void;
  platform?: string;
}

/** How long to wait before trying a refused replacement again, in milliseconds: 300 in all, since nothing else runs meanwhile. */
const WAITS = [10, 20, 40, 80, 150];

/**
 * Puts `temporary` in `path`'s place. On Windows a virus scanner or the search indexer may hold the old
 * file open for a moment, and the replacement is refused; it is tried again a few times before it fails.
 */
function replace(temporary: string, path: string, { rename = renameSync, platform = process.platform }: FileSystem = {}): void {
  for (const wait of platform === "win32" ? WAITS : []) {
    try {
      return rename(temporary, path);
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
  rename(temporary, path);
}

/**
 * Writes a whole file or nothing: the content goes to a new owner-only file beside it, which then
 * replaces the old one in one step. A reader sees the old file or the new one, never half of one.
 */
export function writeAtomic(path: string, content: string, system?: FileSystem): void {
  const temporary = join(dirname(path), `.${basename(path)}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    replace(temporary, path, system);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* The write error is what matters. */
    }
    throw error;
  }
}
