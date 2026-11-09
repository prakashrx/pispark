/** One line of a change: unchanged context, an added line, or a removed one. */
export interface DiffRow {
  kind: "context" | "add" | "del";
  /** Line number in the old file, for context and removed lines. */
  old?: number;
  /** Line number in the new file, for context and added lines. */
  new?: number;
  text: string;
}
export interface DiffHunk {
  /** The first line numbers the hunk covers in the old and the new file. */
  oldStart: number;
  newStart: number;
  rows: DiffRow[];
}
export interface ParsedDiff {
  /** The file the patch names, when it does. */
  path?: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Reads a standard unified patch (as Pi's edit tool reports one) into hunks of numbered lines. */
export function parsePatch(patch: string): ParsedDiff {
  const parsed: ParsedDiff = { hunks: [], added: 0, removed: 0 };
  let hunk: DiffHunk | undefined;
  let old = 0;
  let next = 0;
  for (const line of patch.split("\n")) {
    const header = HUNK.exec(line);
    if (header) {
      old = Number(header[1]);
      next = Number(header[2]);
      hunk = { oldStart: old, newStart: next, rows: [] };
      parsed.hunks.push(hunk);
    } else if (!hunk) {
      const path = /^\+\+\+ (?:b\/)?([^\t]+)/.exec(line)?.[1];
      if (path && path !== "/dev/null") parsed.path = path;
    } else if (line.startsWith("+")) {
      hunk.rows.push({ kind: "add", new: next++, text: line.slice(1) });
      parsed.added++;
    } else if (line.startsWith("-")) {
      hunk.rows.push({ kind: "del", old: old++, text: line.slice(1) });
      parsed.removed++;
    } else if (line.startsWith(" ")) {
      hunk.rows.push({ kind: "context", old: old++, new: next++, text: line.slice(1) });
    }
    // "\ No newline at end of file" and the empty line after the last newline carry nothing to show.
  }
  return parsed;
}
