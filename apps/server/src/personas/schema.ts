import { createHash } from "node:crypto";
import type {
  PersonaDefinition,
  PersonaDiagnostic,
  PersonaRef,
  PersonaSelection,
} from "../persona-protocol.js";
export class PersonaError extends Error {
  constructor(
    readonly code: string,
    readonly status = 422,
    readonly diagnostics: PersonaDiagnostic[] = [{ code }],
  ) {
    super(code);
  }
}
export function fail(code: string, field?: string): never {
  throw new PersonaError(code, 422, [{ code, ...(field ? { field } : {}) }]);
}
export const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const logicalId = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
// Versioned canonical JSON: sorted object keys, ordered arrays, UTF-8, no whitespace.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export const hash = (value: unknown) =>
  digest(canonical({ version: 1, value }));
export function object(
  value: unknown,
  allowed: string[],
  required: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid-definition");
  const o = value as Record<string, unknown>;
  if (
    Object.keys(o).some((k) => !allowed.includes(k)) ||
    required.some((k) => !Object.hasOwn(o, k))
  )
    fail("invalid-definition");
  return o;
}
export function relativePath(value: unknown, reference = false): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    /[\\:\x00-\x1f\x7f]/.test(value) ||
    value.startsWith("/") ||
    value.includes("%")
  )
    fail("path-outside-root");
  if (reference && value === ".") return value;
  const parts = value.split("/");
  if (
    parts.length > (reference ? 8 : 16) ||
    parts.some(
      (p) =>
        !p ||
        p.length > 120 ||
        (/[. ]$/.test(p) && p !== ".." && p !== ".") ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) ||
        (reference && (p === "." || p === "..")),
    )
  )
    fail("path-outside-root");
  return value;
}
export function ref(
  value: unknown,
  selection = false,
): PersonaRef | PersonaSelection {
  const o = object(
    value,
    ["root", "path", "id", ...(selection ? ["revision"] : [])],
    ["root", "path", "id", ...(selection ? ["revision"] : [])],
  );
  if (
    typeof o.root !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(o.root) ||
    typeof o.id !== "string" ||
    !uuid.test(o.id)
  )
    fail("invalid-definition");
  relativePath(o.path, true);
  if (
    selection &&
    (typeof o.revision !== "string" || !/^[a-f0-9]{64}$/.test(o.revision))
  )
    fail("invalid-definition");
  // SAFETY: exact keys, root/path, UUID and optional revision were validated above.
  return o as unknown as PersonaRef;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail("limit");
  return value;
}
function id(value: unknown) {
  if (typeof value !== "string" || value.length > 64 || !logicalId.test(value))
    fail("invalid-definition");
  return value;
}
function selectors(value: unknown) {
  const o = object(value, ["instructions", "skills"]);
  for (const type of ["instructions", "skills"] as const)
    if (o[type] !== undefined) {
      const values = list(o[type], 64).map(id);
      if (new Set(values).size !== values.length) fail("invalid-definition");
    }
}
export function definition(value: unknown): PersonaDefinition {
  const o = object(
    value,
    [
      "schemaVersion",
      "id",
      "name",
      "description",
      "parents",
      "instructions",
      "skills",
      "exclude",
    ],
    ["schemaVersion", "id", "name"],
  );
  if (o.schemaVersion !== 1) fail("unsupported-version");
  if (
    typeof o.id !== "string" ||
    !uuid.test(o.id) ||
    typeof o.name !== "string" ||
    !o.name.trim() ||
    o.name !== o.name.trim() ||
    o.name.length > 120 ||
    /[\x00-\x1f\x7f]/.test(o.name)
  )
    fail("invalid-definition");
  if (
    o.description !== undefined &&
    (typeof o.description !== "string" ||
      o.description.length > 1024 ||
      o.description.includes("\0"))
  )
    fail("invalid-definition");
  if (Buffer.byteLength(JSON.stringify(o)) > 128 * 1024) fail("limit");
  if (o.parents !== undefined) {
    const seen = new Set<string>();
    for (const parent of list(o.parents, 8)) {
      const p = object(
        parent,
        ["root", "path", "id", "include"],
        ["root", "path", "id"],
      );
      ref({ root: p.root, path: p.path, id: p.id });
      const key = `${p.root}/${p.path}`;
      if (seen.has(key)) fail("invalid-definition");
      seen.add(key);
      if (p.include !== undefined) selectors(p.include);
    }
  }
  if (o.exclude !== undefined) selectors(o.exclude);
  for (const type of ["instructions", "skills"] as const)
    if (o[type] !== undefined) {
      const seen = new Set<string>();
      for (const entry of list(o[type], 32)) {
        const e = object(
          entry,
          type === "instructions"
            ? ["id", "text", "file", "replace"]
            : ["id", "directory", "replace"],
          ["id"],
        );
        const key = id(e.id);
        if (seen.has(key)) fail("invalid-definition");
        seen.add(key);
        if (e.replace !== undefined && e.replace !== true)
          fail("invalid-definition");
        if (type === "instructions") {
          if (Object.hasOwn(e, "text") === Object.hasOwn(e, "file"))
            fail("invalid-definition");
          if (Object.hasOwn(e, "text")) {
            if (
              typeof e.text !== "string" ||
              !e.text.trim() ||
              e.text.includes("\0") ||
              Buffer.byteLength(e.text) > 64 * 1024
            )
              fail("invalid-definition");
          } else {
            const path = relativePath(e.file);
            if (!/\.(md|txt)$/i.test(path)) fail("invalid-definition");
          }
        } else relativePath(e.directory);
      }
    }
  // SAFETY: every supported field and nested collection was checked above; cloning detaches caller mutation.
  return structuredClone(o) as unknown as PersonaDefinition;
}
