import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { build, transform, type Plugin } from "esbuild";
import { compile, compileModule } from "svelte/compiler";
import { SHARED_SVELTE } from "./shared-svelte.js";

/**
 * Turns an extension's Svelte component (and what it imports) into one browser module. Imports of
 * `svelte` resolve to the app's own Svelte instance, which the page shares as `globalThis.__pisparkSvelte`,
 * so an extension's component mounts inside PiSpark's tree like PiSpark's own.
 */

const MAX_BUNDLE = 2 * 1024 * 1024;
const MAX_BUNDLES = 256;

const sharedSvelte: Plugin = {
  name: "pispark-shared-svelte",
  setup(build) {
    build.onResolve({ filter: /^svelte(\/|$)/ }, (args) => ({ path: args.path, namespace: "pispark-svelte" }));
    build.onLoad({ filter: /.*/, namespace: "pispark-svelte" }, (args) => {
      if (!(SHARED_SVELTE as readonly string[]).includes(args.path))
        return { errors: [{ text: `PiSpark does not provide "${args.path}" to extension components` }] };
      return {
        contents: `module.exports = globalThis.__pisparkSvelte[${JSON.stringify(args.path)}];`,
        loader: "js",
      };
    });
  },
};

/** Svelte's own error, with where it is, for esbuild to report. */
function svelteError(error: unknown, file: string) {
  const { message, start } = error as { message?: string; start?: { line: number; column: number } };
  return {
    errors: [
      {
        text: (message ?? String(error)).split("\n")[0]!,
        location: { file, line: start?.line ?? 1, column: start?.column ?? 0 },
      },
    ],
  };
}

const svelteFiles: Plugin = {
  name: "pispark-svelte-files",
  setup(build) {
    // Components; runes only, like PiSpark's own (legacy mode would switch the shared runtime).
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      try {
        const { js } = compile(source, { filename: args.path, generate: "client", css: "injected", runes: true });
        return { contents: js.code, loader: "js", resolveDir: dirname(args.path) };
      } catch (error) {
        return svelteError(error, args.path);
      }
    });
    // Modules with runes: `.svelte.js` and `.svelte.ts`.
    build.onLoad({ filter: /\.svelte\.(js|ts)$/ }, async (args) => {
      let source = await readFile(args.path, "utf8");
      try {
        if (args.path.endsWith(".ts")) source = (await transform(source, { loader: "ts" })).code;
        const { js } = compileModule(source, { filename: args.path, generate: "client" });
        return { contents: js.code, loader: "js", resolveDir: dirname(args.path) };
      } catch (error) {
        return svelteError(error, args.path);
      }
    });
  },
};

/** Compiled modules by content hash; the browser imports them from `/api/views/<hash>.js`. */
const bundles = new Map<string, string>();

/** A compiled module, for serving. */
export const viewBundle = (hash: string): string | undefined => bundles.get(hash);

/** Compiles a component file; the result is addressed by its content, so it can be cached forever. */
export async function compileView(file: string): Promise<string> {
  let output: string;
  try {
    const result = await build({
      entryPoints: [file],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
      plugins: [sharedSvelte, svelteFiles],
    });
    output = result.outputFiles[0]!.text;
  } catch (error) {
    // esbuild's first error, with where it is: "Broken.svelte:5:8 Unterminated regular expression".
    const first = (error as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors?.[0];
    if (!first) throw new Error((error as Error).message);
    const at = first.location ? `${basename(first.location.file)}:${first.location.line}:${first.location.column} ` : "";
    throw new Error(`${at}${first.text}`);
  }
  if (output.length > MAX_BUNDLE) throw new Error("The component is too large to load");
  const hash = createHash("sha256").update(output).digest("hex").slice(0, 32);
  bundles.delete(hash);
  bundles.set(hash, output);
  // Keep the most recently compiled; an evicted one is compiled again when a chat reopens.
  while (bundles.size > MAX_BUNDLES) bundles.delete(bundles.keys().next().value!);
  return hash;
}
