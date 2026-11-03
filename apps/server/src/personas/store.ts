import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  renameSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  PersonaDefinition,
  PersonaRef,
  PersonaSummary,
} from "../persona-protocol.js";
import { type SafeLogger, silentLogger } from "../logger.js";
import {
  definition,
  digest,
  hash,
  fail,
  PersonaError,
  ref as validateRef,
  relativePath,
  uuid,
} from "./schema.js";
import {
  atomicWrite,
  bytes,
  contained,
  inside,
  noLinks,
  storageError,
  text,
} from "./files.js";
import {
  resolvePersona,
  publicView,
  type ResolvedPersona,
} from "./resolver.js";

export interface StoredPersona {
  ref: PersonaRef;
  root: string;
  directory: string;
  definition: PersonaDefinition;
  definitionRevision: string;
  writable: boolean;
}
export class PersonaStore {
  readonly roots: Readonly<Record<string, string>>;
  private writes = new Set<Promise<unknown>>();
  private closed = false;
  constructor(
    directory: string,
    roots: Record<string, string> = {},
    readonly logger: SafeLogger = silentLogger,
  ) {
    if (
      !isAbsolute(directory) ||
      Object.keys(roots).length > 15 ||
      Object.entries(roots).some(
        ([key, path]) =>
          key === "managed" ||
          !/^[a-z][a-z0-9-]{0,63}$/.test(key) ||
          !isAbsolute(path),
      )
    )
      throw new PersonaError("invalid-definition", 400);
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      noLinks(directory);
    } catch (error) {
      storageError(error);
    }
    this.roots = Object.freeze({ managed: resolve(directory), ...roots });
  }
  location(reference: PersonaRef): {
    root: string;
    directory: string;
    writable: boolean;
  } {
    validateRef(reference);
    const root = Object.hasOwn(this.roots, reference.root)
      ? this.roots[reference.root]!
      : undefined;
    if (!root) throw new PersonaError("missing-parent", 404);
    const directory = resolve(root, reference.path);
    if (!inside(root, directory)) fail("path-outside-root");
    return { root, directory, writable: reference.root === "managed" };
  }
  read(reference: PersonaRef): StoredPersona {
    try {
      const location = this.location(reference);
      contained(location.root, location.directory, "directory");
      const path = contained(
        location.root,
        join(location.directory, "persona.json"),
        "file",
      );
      const content = bytes(path, 128 * 1024);
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(content),
        );
      } catch {
        fail("invalid-definition");
      }
      const value = definition(parsed);
      if (value.id !== reference.id) fail("identity-mismatch");
      return {
        ...location,
        ref: { ...reference },
        definition: value,
        definitionRevision: digest(content),
      };
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException)?.code ?? "",
        )
      )
        throw new PersonaError("missing-parent", 404);
      storageError(error);
    }
  }
  discover(): {
    ref: PersonaRef;
    writable: boolean;
    definition?: PersonaDefinition;
    diagnostics: { code: string }[];
  }[] {
    const results: ReturnType<PersonaStore["discover"]> = [];
    let entries = 0;
    const ids = new Map<string, number>();
    try {
      for (const [key, root] of Object.entries(this.roots)) {
        contained(root, root, "directory");
        const visit = (dir: string, depth: number) => {
          if (depth > 8) fail("limit");
          const path = relative(root, dir).split(/[/\\]/).join("/") || ".";
          if (existsSync(join(dir, "persona.json"))) {
            if (results.length >= 256) fail("limit");
            let value: PersonaDefinition | undefined,
              id = "",
              diagnostics: { code: string }[] = [];
            try {
              contained(root, join(dir, "persona.json"), "file");
              const raw = JSON.parse(
                text(join(dir, "persona.json"), 128 * 1024),
              );
              if (typeof raw?.id === "string" && uuid.test(raw.id)) id = raw.id;
              value = definition(raw);
            } catch (error) {
              diagnostics = [
                {
                  code:
                    error instanceof PersonaError
                      ? error.code
                      : "invalid-definition",
                },
              ];
            }
            if (id) {
              const previous = ids.get(id);
              if (previous !== undefined) {
                results[previous]!.diagnostics = [
                  { code: "duplicate-identity" },
                ];
                diagnostics = [{ code: "duplicate-identity" }];
              }
              ids.set(id, results.length);
            }
            results.push({
              ref: { root: key, path, id },
              writable: key === "managed",
              definition: value,
              diagnostics,
            });
            return;
          }
          for (const name of readdirSync(dir).sort()) {
            if (++entries > 2048) fail("limit");
            if (
              [".git", "node_modules"].includes(name) ||
              name.startsWith(".persona-")
            )
              continue;
            const target = contained(root, join(dir, name));
            if (lstatSync(target).isDirectory()) visit(target, depth + 1);
          }
        };
        visit(root, 0);
      }
      return results;
    } catch (error) {
      storageError(error);
    }
  }
  assertIdentities(): void {
    if (
      this.discover().some((p) =>
        p.diagnostics.some((d) => d.code === "duplicate-identity"),
      )
    )
      fail("duplicate-identity");
  }
  list(cursor = 0, maximum = 256): PersonaSummary[] {
    return this.discover()
      .slice(cursor, cursor + maximum)
      .map((item) => {
        const summary: PersonaSummary = {
          ref: item.ref,
          name: item.definition?.name ?? "Invalid persona",
          description: item.definition?.description,
          writable: item.writable,
          valid: false,
          diagnostics: item.diagnostics,
        };
        if (!item.definition || item.diagnostics.length) return summary;
        try {
          const resolved = resolvePersona(this, item.ref, undefined, false);
          return {
            ...summary,
            valid: true,
            revision: resolved.revision,
            skillCount: resolved.skills.length,
          };
        } catch (error) {
          return {
            ...summary,
            diagnostics:
              error instanceof PersonaError
                ? error.diagnostics
                : [{ code: "storage" }],
          };
        }
      });
  }
  private write<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new PersonaError("shutdown", 503));
    if (this.writes.size >= 16)
      return Promise.reject(new PersonaError("busy", 409));
    const pending = operation();
    this.writes.add(pending);
    void pending.finally(() => this.writes.delete(pending)).catch(() => {});
    return pending;
  }
  private async locked<T>(directory: string, operation: () => T): Promise<T> {
    const lock = join(directory, ".persona-write.lock");
    const until = Date.now() + 1000;
    for (;;) {
      try {
        noLinks(directory);
        mkdirSync(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST")
          storageError(error);
        if (Date.now() >= until) throw new PersonaError("busy", 409);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return operation();
    } catch (error) {
      storageError(error);
    } finally {
      rmdirSync(lock);
    }
  }
  create(input: unknown) {
    return this.write(async () => {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.hasOwn(input, "id")
      )
        throw new PersonaError("invalid-definition", 400);
      const id = randomUUID(),
        value = definition({ ...input, id });
      const reference = { root: "managed", path: id, id };
      const root = this.roots.managed!,
        staged = join(root, `.persona-${id}`),
        target = join(root, id);
      try {
        noLinks(root);
        mkdirSync(staged, { mode: 0o700 });
        atomicWrite(
          join(staged, "persona.json"),
          JSON.stringify(value, null, 2) + "\n",
          () => noLinks(staged),
        );
        // Empty creation is immediately useful; file/skill references must already exist.
        const preview = publicView(
          resolvePersona(this, reference, value, true, staged),
        );
        if (Buffer.byteLength(JSON.stringify(preview)) > 512 * 1024)
          fail("limit");
        noLinks(root);
        renameSync(staged, target);
        this.logger.event("persona.save", {
          personaId: id,
          outcome: "completed",
        });
        return publicView(resolvePersona(this, reference));
      } catch (error) {
        storageError(error);
      } finally {
        rmSync(staged, { force: true, recursive: true });
      }
    });
  }
  save(reference: PersonaRef, expectedRevision: string, input: unknown) {
    return this.write(async () => {
      const current = this.read(reference);
      if (!current.writable) throw new PersonaError("read-only", 403);
      const value = definition(input);
      if (value.id !== reference.id) fail("identity-mismatch");
      return this.locked(current.directory, () => {
        const check = (temporary?: string) => {
          if (
            resolvePersona(
              this,
              reference,
              undefined,
              true,
              undefined,
              temporary,
            ).revision !== expectedRevision
          )
            throw new PersonaError("revision-conflict", 409);
        };
        check();
        const preview = publicView(resolvePersona(this, reference, value));
        if (Buffer.byteLength(JSON.stringify(preview)) > 512 * 1024)
          fail("limit");
        atomicWrite(
          join(current.directory, "persona.json"),
          JSON.stringify(value, null, 2) + "\n",
          (temporary) => {
            contained(current.root, current.directory, "directory");
            check(temporary);
          },
        );
        this.logger.event("persona.save", {
          personaId: reference.id,
          outcome: "completed",
        });
        return publicView(resolvePersona(this, reference));
      });
    });
  }
  instruction(reference: PersonaRef, path: string) {
    const current = this.read(reference);
    relativePath(path);
    if (!current.definition.instructions?.some((i) => i.file === path))
      fail("invalid-definition");
    try {
      const file = contained(
        current.root,
        resolve(current.directory, path),
        "file",
      );
      const content = bytes(file, 64 * 1024);
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(content),
        revision: digest(content),
      };
    } catch (error) {
      storageError(error);
    }
  }
  saveInstruction(
    reference: PersonaRef,
    path: string,
    expectedRevision: string | null,
    value: string,
  ) {
    return this.write(async () => {
      const current = this.read(reference);
      if (!current.writable) throw new PersonaError("read-only", 403);
      relativePath(path);
      if (
        !/\.(md|txt)$/i.test(path) ||
        path
          .split("/")
          .some(
            (p) =>
              p === "." ||
              p === ".." ||
              p.toLowerCase() === ".persona-write.lock",
          ) ||
        /(^|\/)persona\.json$/i.test(path) ||
        typeof value !== "string" ||
        !value.trim() ||
        value.includes("\0") ||
        Buffer.byteLength(value) > 64 * 1024
      )
        fail("invalid-definition");
      const target = resolve(current.directory, path);
      if (!inside(current.directory, target)) fail("path-outside-root");
      if (/(^|\/)SKILL\.md$/i.test(path))
        throw new PersonaError("read-only", 403);
      return this.locked(current.directory, () => {
        const check = () => {
          const latest = this.read(reference);
          contained(latest.root, latest.directory, "directory");
          if (
            latest.definition.skills?.some((s) =>
              inside(resolve(latest.directory, s.directory), target),
            )
          )
            throw new PersonaError("read-only", 403);
          if (
            existsSync(target) &&
            !latest.definition.instructions?.some((i) => i.file === path)
          )
            fail("invalid-definition");
          // Provisioned skill trees stay read-only even before they are referenced by this definition.
          for (
            let dir = dirname(target);
            inside(current.directory, dir);
            dir = dirname(dir)
          ) {
            if (existsSync(dir)) {
              contained(current.directory, dir, "directory");
              if (existsSync(join(dir, "SKILL.md")))
                throw new PersonaError("read-only", 403);
            }
            if (dir === current.directory) break;
          }
          const revision = existsSync(target)
            ? digest(
                bytes(contained(current.directory, target, "file"), 64 * 1024),
              )
            : null;
          if (revision !== expectedRevision)
            throw new PersonaError("revision-conflict", 409);
        };
        // Only owned .md/.txt paths; not an arbitrary file read/write endpoint.
        check();
        let before: ResolvedPersona | undefined;
        try {
          before = resolvePersona(this, reference);
        } catch {
          /* a missing instruction file may be repaired by this operation */
        }
        let dir = current.directory;
        for (const part of relative(current.directory, dirname(target))
          .split(/[/\\]/)
          .filter(Boolean)) {
          dir = join(dir, part);
          if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 });
          contained(current.directory, dir, "directory");
        }
        atomicWrite(target, value, () => {
          contained(current.directory, dirname(target), "directory");
          check();
        });
        let revision: string | undefined, beforeRevision: string | undefined;
        try {
          const after = resolvePersona(this, reference);
          revision = after.revision;
          // Prove the post-write graph differs only in this owned file, including changes
          // by another process during the write. This is optimistic evidence, not OS CAS.
          if (before) {
            const ownedIds = new Set(
              before.definition.instructions
                ?.filter((i) => i.file === path)
                .map((i) => i.id),
            );
            const resources = after.revisionInputs.resources.map((r) => {
              if (
                r.type !== "instructions" ||
                r.ref.id !== reference.id ||
                !ownedIds.has(r.id)
              )
                return r;
              const prior = before!.revisionInputs.resources.find(
                (p) =>
                  p.type === r.type && p.ref.id === r.ref.id && p.id === r.id,
              );
              return prior ? { ...r, digest: prior.digest } : r;
            });
            if (
              hash({ definitions: after.definitions, resources }) ===
              before.revision
            )
              beforeRevision = before.revision;
          }
        } catch {
          /* existing invalid definition remains repairable */
        }
        return { fileRevision: digest(value), beforeRevision, revision };
      });
    });
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.writes]);
  }
}
