import { blockHtml, lexBlocks, type Flavor } from "./parse";

/**
 * A top-level piece of a Markdown text as written: a paragraph, list, table, code block, or the
 * front matter at the very start. `source` is exactly the text from `start`, without the blank
 * lines after it, so replacing it changes nothing else.
 */
export interface SourceBlock {
  start: number;
  source: string;
  /** The Markdown token type ("paragraph", "list", "code"…), or "frontmatter". */
  kind: string;
  /** HTML, not yet sanitized. Empty for front matter. */
  html: string;
}

export const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/;

/** Splits `text` into its blocks. Everything between them is blank lines, kept as they are. */
export function sourceBlocks(text: string, flavor: Flavor = "prose"): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let offset = 0;
  const front = FRONT_MATTER.exec(text);
  if (front) {
    blocks.push({ start: 0, source: front[0], kind: "frontmatter", html: "" });
    offset = front[0].length;
  }
  const body = text.slice(offset);
  const lexed = lexBlocks(flavor, body);
  for (const { start, token } of lexed.blocks) {
    const source = token.raw.replace(/\s+$/, "");
    if (!source) continue;
    blocks.push({ start: offset + start, source, kind: token.type, html: blockHtml(flavor, token, lexed.links) });
  }
  return blocks;
}

/** The starts of the blocks of `text` whose source isn't a block of `compare`. */
export function changedBlocks(blocks: SourceBlock[], compare: string, flavor: Flavor = "prose"): Set<number> {
  const before = new Set(sourceBlocks(compare, flavor).map((block) => normalize(block.source)));
  return new Set(blocks.filter((block) => !before.has(normalize(block.source))).map((block) => block.start));
}

const normalize = (source: string) => source.replace(/\r\n/g, "\n").trim();

/**
 * The text with plain `\n` line endings, as the editor works with it, and a way back: only the
 * span that changed is written into the original, with its line endings, so every other
 * character, a mixed line ending included, stays as it was.
 */
export function lineEndings(text: string): { lf: string; restore: (lf: string) => string } {
  const lf = text.replace(/\r\n/g, "\n");
  const crlf = text.includes("\r\n");
  // Where each position of `lf` is in `text`.
  const at: number[] = [];
  for (let i = 0, o = 0; i <= lf.length; i++) {
    at.push(o);
    o += text[o] === "\r" && text[o + 1] === "\n" ? 2 : 1;
  }
  return {
    lf,
    restore(next) {
      if (next === lf) return text;
      const most = Math.min(lf.length, next.length);
      let head = 0;
      while (head < most && lf[head] === next[head]) head++;
      let tail = 0;
      while (tail < most - head && lf[lf.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
      const middle = next.slice(head, next.length - tail);
      return text.slice(0, at[head]) + (crlf ? middle.replace(/\n/g, "\r\n") : middle) + text.slice(at[lf.length - tail]);
    },
  };
}
