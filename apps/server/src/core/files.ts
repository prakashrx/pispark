import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** Whether `path` is `root` or inside it. A name that only starts with two dots (`..notes`) is inside. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Writes a whole file or nothing: the content goes to a new owner-only file beside it, which then
 * replaces the old one in one step. A reader sees the old file or the new one, never half of one.
 */
export function writeAtomic(path: string, content: string): void {
  const temporary = join(dirname(path), `.${basename(path)}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* The write error is what matters. */
    }
    throw error;
  }
}
