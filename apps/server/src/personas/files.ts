import {
  lstatSync,
  realpathSync,
  readFileSync,
  readdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import {
  isAbsolute,
  relative,
  resolve,
  dirname,
  basename,
  join,
  parse,
} from "node:path";
import { randomUUID } from "node:crypto";
import { digest, fail, PersonaError, relativePath } from "./schema.js";
export interface FileManifest {
  path: string;
  digest: string;
  bytes: number;
  mode: number;
}
export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel !== ".." &&
    !rel.startsWith("../") &&
    !rel.startsWith("..\\") &&
    !isAbsolute(rel)
  );
}
/** Refuse symlinks/junctions on every existing component, including operator-root ancestors. */
export function noLinks(path: string): void {
  const absolute = resolve(path),
    root = parse(absolute).root;
  let current = root;
  for (const part of relative(root, absolute).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail("symlink");
  }
}
export function contained(
  root: string,
  path: string,
  kind?: "file" | "directory",
): string {
  if (!inside(resolve(root), resolve(path))) fail("path-outside-root");
  noLinks(root);
  noLinks(path);
  const canonicalRoot = realpathSync(root),
    canonical = realpathSync(path);
  if (!inside(canonicalRoot, canonical)) fail("path-outside-root");
  const info = lstatSync(canonical);
  if (
    kind === "file"
      ? !info.isFile()
      : kind === "directory"
        ? !info.isDirectory()
        : !info.isFile() && !info.isDirectory()
  )
    fail("invalid-resource");
  return canonical;
}
export function resourcePath(
  root: string,
  directory: string,
  path: string,
  kind: "file" | "directory",
): string {
  relativePath(path);
  return contained(root, resolve(directory, path), kind);
}
export function bytes(path: string, max: number): Buffer {
  noLinks(path);
  const info = lstatSync(path);
  if (!info.isFile()) fail("invalid-resource");
  if (info.size > max) fail("limit");
  const value = readFileSync(path);
  if (value.length > max) fail("limit");
  return value;
}
export function text(path: string, max: number): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes(path, max));
  } catch (error) {
    if (error instanceof PersonaError) throw error;
    fail("invalid-resource");
  }
}
export function tree(
  directory: string,
  operationTemporary?: string,
): FileManifest[] {
  const result: FileManifest[] = [];
  let total = 0,
    entries = 0;
  const visit = (dir: string, depth: number) => {
    if (depth > 8) fail("limit");
    contained(directory, dir, "directory");
    for (const name of readdirSync(dir).sort()) {
      // Only the exact temporary file owned by this atomic write is absent from its comparison.
      if (
        operationTemporary &&
        relative(operationTemporary, join(dir, name)) === ""
      )
        continue;
      if (++entries > 512) fail("limit");
      relativePath(name);
      const path = join(dir, name);
      const canonical = contained(directory, path);
      const info = lstatSync(canonical);
      if (info.isDirectory()) {
        if ([".git", "node_modules"].includes(name)) fail("invalid-resource");
        visit(canonical, depth + 1);
      } else {
        const content = bytes(canonical, 1024 * 1024);
        total += content.length;
        if (total > 8 * 1024 * 1024 || result.length >= 256) fail("limit");
        result.push({
          path: relative(directory, canonical).split(/[/\\]/).join("/"),
          digest: digest(content),
          bytes: content.length,
          mode: info.mode & 0o777,
        });
      }
    }
  };
  visit(directory, 0);
  if (!result.some((f) => f.path === "SKILL.md")) fail("missing-resource");
  return result;
}
export function atomicWrite(
  path: string,
  value: string | Buffer,
  recheck: (temporary: string) => void,
): void {
  const temporary = join(
    dirname(path),
    `.${basename(path)}-${randomUUID()}.tmp`,
  );
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, value);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    recheck(temporary);
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temporary);
    } catch {
      /* absent after successful rename */
    }
  }
}
export function storageError(error: unknown): never {
  if (error instanceof PersonaError) throw error;
  if (
    ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException)?.code ?? "")
  )
    fail("missing-resource");
  throw new PersonaError("storage", 500);
}
