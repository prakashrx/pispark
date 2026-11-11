import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The three zones of the server and who may import whom (docs/architecture.md):
 *   contract  types and pure functions any client may import; imports nothing else
 *   core      the hosting layer; imports contract only
 *   http      the local server; imports core and contract
 * The web imports the server only through contract.
 */
const src = fileURLToPath(new URL("../src/", import.meta.url));
const web = fileURLToPath(new URL("../../web/", import.meta.url));
const ALLOWED: Record<string, string[]> = {
  contract: ["contract"],
  core: ["core", "contract"],
  http: ["http", "core", "contract"],
  "index.ts": ["http", "core", "contract"],
};

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name === "node_modules" || entry.name === "dist"
      ? []
      : entry.isDirectory()
        ? walk(join(dir, entry.name))
        : /\.(ts|svelte)$/.test(entry.name)
          ? [join(dir, entry.name)]
          : [],
  );
/** Relative specifiers a file imports, statically or dynamically. */
const imports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)].map(
    (match) => match[1]!,
  );
const zone = (file: string) => relative(src, file).split(sep)[0]!;
const inside = (root: string, file: string) => !relative(root, file).startsWith("..");

test("the server's zones import only what they may", () => {
  const broken: string[] = [];
  for (const file of walk(src)) {
    const allowed = ALLOWED[zone(file)];
    assert.ok(allowed, `${relative(src, file)} is outside contract/, core/ and http/`);
    for (const spec of imports(file)) {
      const target = resolve(dirname(file), spec);
      if (!inside(src, target)) broken.push(`${relative(src, file)} imports outside src: ${spec}`);
      else if (!allowed.includes(zone(target))) broken.push(`${relative(src, file)} (${zone(file)}) imports ${zone(target)}: ${spec}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("the contract depends on nothing but itself", () => {
  for (const file of walk(join(src, "contract")))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /from\s+["'](?!\.\/)[^"']+["']/,
      `${relative(src, file)} imports a package or another zone`,
    );
});

test("the web imports the server only through its contract", () => {
  const broken: string[] = [];
  for (const root of ["src", "tests"].map((name) => join(web, name)).filter((dir) => existsSync(dir) && statSync(dir).isDirectory()))
    for (const file of walk(root))
      for (const spec of imports(file)) {
        const target = resolve(dirname(file), spec);
        if (inside(resolve(src, ".."), target) && !(inside(src, target) && zone(target) === "contract"))
          broken.push(`${relative(web, file)}: ${spec}`);
      }
  assert.deepEqual(broken, []);
});
