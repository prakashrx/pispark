import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** The folder this PiSpark runs from: a checkout, or an installed release's `app/`. Both hold `docs/`. */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The version the notes are written for: a build of main (`0.7.0-main.52`) shares its version's (`0.7.0`). */
export const notesVersion = (version: string) => /^\d+\.\d+\.\d+/.exec(version)?.[0];

/**
 * What is new in a version, as Markdown: `docs/releases/<version>.md`, written with each change and
 * carried by every release (docs/releasing.md). Without a version (a server started from its
 * source), the version in the checkout's `package.json`. Undefined when there are none.
 */
export function releaseNotes(version?: string, root = ROOT): { version: string; notes: string } | undefined {
  try {
    const base = notesVersion(version ?? (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version);
    if (!base) return undefined;
    const notes = readFileSync(join(root, "docs", "releases", `${base}.md`), "utf8").trim();
    return notes ? { version: base, notes } : undefined;
  } catch {
    return undefined;
  }
}
