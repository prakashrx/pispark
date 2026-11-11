/**
 * The live document and its deltas. One small vocabulary, shared by the server (which diffs) and
 * the browser (which applies): `set` a value, `append` to a string, `del` an object key.
 * No imports, so the browser can use the same file.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Path = (string | number)[];
export type DocOp =
  | { op: "set"; path: Path; value: Json }
  | { op: "append"; path: Path; text: string }
  | { op: "del"; path: Path };

const isObject = (value: unknown): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The operations that turn `previous` into `next`. A string that only grew is an `append`; an
 * array that only grew sets its new elements; a shorter array is replaced whole.
 */
export function diffOps(previous: Json | undefined, next: Json, path: Path = [], out: DocOp[] = []): DocOp[] {
  if (previous === next) return out;
  if (typeof previous === "string" && typeof next === "string") {
    if (next.length > previous.length && next.startsWith(previous))
      out.push({ op: "append", path, text: next.slice(previous.length) });
    else out.push({ op: "set", path, value: next });
  } else if (isObject(previous) && isObject(next)) {
    for (const key of Object.keys(previous)) if (!(key in next)) out.push({ op: "del", path: [...path, key] });
    for (const key of Object.keys(next)) diffOps(previous[key], next[key]!, [...path, key], out);
  } else if (Array.isArray(previous) && Array.isArray(next) && next.length >= previous.length) {
    for (let index = 0; index < next.length; index++) diffOps(previous[index], next[index]!, [...path, index], out);
  } else if (JSON.stringify(previous) !== JSON.stringify(next)) out.push({ op: "set", path, value: next });
  return out;
}

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** Applies one operation in place to a document whose root is an object. */
export function applyOp(root: { [key: string]: Json }, op: DocOp): void {
  const { path } = op;
  if (path.length === 0 || path.some((key) => typeof key === "string" && FORBIDDEN.has(key)))
    throw new Error("Invalid path");
  let parent: any = root;
  for (const key of path.slice(0, -1)) {
    parent = parent?.[key];
    if (typeof parent !== "object" || parent === null) throw new Error("Invalid path");
  }
  const last = path.at(-1)!;
  if (op.op === "set") parent[last] = op.value;
  else if (op.op === "del") delete parent[last];
  else {
    if (typeof parent[last] !== "string") throw new Error("Invalid append");
    parent[last] += op.text;
  }
}
