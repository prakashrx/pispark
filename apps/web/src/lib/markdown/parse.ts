import { Marked, type MarkedExtension, type Token, type TokenizerAndRendererExtension, type Tokens } from "marked";
import { footnotes, noteList } from "./footnotes";

/** A top-level piece of a text: a paragraph, list, table, code block… keyed by where it starts. */
export interface Block {
  start: number;
  /** The Markdown token type: "paragraph", "table", "code"… */
  kind: string;
  /** HTML, not yet sanitized. */
  html: string;
  /** Still being written: it changes with the next update. */
  open?: boolean;
}

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** `$…$` and `\(…\)` inline, `$$…$$` and `\[…\]` on their own lines; "$5 and $10" stays text. */
const math: TokenizerAndRendererExtension[] = [
  {
    name: "mathBlock",
    level: "block",
    start: (src) => src.match(/^ {0,3}(\$\$|\\\[)/m)?.index,
    tokenizer(src) {
      const match = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]) *(?:\n|$)/.exec(src);
      if (match) return { type: "mathBlock", raw: match[0], text: (match[1] ?? match[2] ?? "").trim() };
    },
    renderer: (token) => `<div data-math="block">${escapeHtml(token.text as string)}</div>`,
  },
  {
    name: "mathInline",
    level: "inline",
    start: (src) => src.match(/\$|\\\(/)?.index,
    tokenizer(src) {
      const match = /^(?:\$(?![\s$])((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)|\\\((.+?)\\\))/.exec(src);
      if (match) return { type: "mathInline", raw: match[0], text: match[1] ?? match[2] ?? "" };
    },
    renderer: (token) => `<span data-math="inline">${escapeHtml(token.text as string)}</span>`,
  },
];

/** Code keeps its language as `data-lang`, for highlighting and for renderers of known languages. */
const code: MarkedExtension = {
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      const label = language ? ` data-lang="${escapeHtml(language)}"` : "";
      return `<pre${label}><code>${escapeHtml(text.replace(/\n$/, ""))}</code></pre>\n`;
    },
  },
};

function create(breaks: boolean): Marked {
  return new Marked({ gfm: true, breaks }, footnotes, { extensions: math }, code);
}

const parsers = { prose: create(false), typed: create(true) };
export type Flavor = keyof typeof parsers;

/** One token (and the link definitions of its text) as HTML, not yet sanitized. */
function renderToken(flavor: Flavor, token: Token, links: Tokens.Generic["links"]): string {
  return parsers[flavor].parser(Object.assign([token], { links }) as unknown as Token[]);
}

/**
 * Closes what a half-written block leaves open, so it reads as the author meant it: an unclosed
 * code span or emphasis is closed, and a link with no end shows as plain text. An unclosed code
 * fence needs nothing: Markdown already treats it as code to the end.
 */
export function repairOpenBlock(raw: string): string {
  if ((raw.match(/^ {0,3}(```|~~~)/gm)?.length ?? 0) % 2 === 1) return raw;
  let text = raw;
  // An open code span swallows everything after it; close it and stop.
  let inCode = false;
  for (const char of text) if (char === "`") inCode = !inCode;
  if (inCode) return text + "`";
  const plain = text.replace(/`[^`]*`/g, "");
  if ((plain.match(/\*\*/g) ?? []).length % 2 === 1) text += "**";
  const single = plain
    .replace(/\*\*/g, "")
    .replace(/^\s*[*+-]\s/gm, "")
    .match(/\*/g);
  if ((single?.length ?? 0) % 2 === 1) text += "*";
  if (/\[[^\]\n]*$/.test(text)) text = text.replace(/\[([^\]\n]*)$/, "\\[$1");
  else if (/\]\([^)\n]*$/.test(text)) text += ")";
  return text;
}

/** One top-level token as HTML, with the link definitions of its whole text; not yet sanitized. */
export function blockHtml(flavor: Flavor, token: Token, links: Tokens.Generic["links"]): string {
  return renderToken(flavor, token, links);
}

/** The top-level tokens of `text` with where each starts, and the text's link definitions. Blank lines are left out. */
export function lexBlocks(flavor: Flavor, text: string): { blocks: { start: number; token: Token }[]; links: Tokens.Generic["links"] } {
  const tokens = parsers[flavor].lexer(text);
  const blocks: { start: number; token: Token }[] = [];
  let at = 0;
  for (const token of tokens) {
    if (token.type !== "space") blocks.push({ start: at, token });
    at += token.raw.length;
  }
  return { blocks, links: tokens.links };
}

interface Lexed {
  start: number;
  token: Token;
  render(): Block;
}

/** Splits `text`, which starts at `offset` in the whole, into blocks rendered when asked. */
function lex(flavor: Flavor, text: string, offset: number): Lexed[] {
  const tokens = parsers[flavor].lexer(text);
  const notes = noteList(tokens);
  if (notes) tokens.push(notes);
  const blocks: Lexed[] = [];
  let at = offset;
  for (const token of tokens) {
    // A footnote's text is drawn with the others, in the list that comes last.
    const start = at;
    if (token.type !== "space" && token.type !== "footnote")
      blocks.push({ start, token, render: () => ({ start, kind: token.type, html: renderToken(flavor, token, tokens.links) }) });
    at += token.raw.length;
  }
  return blocks;
}

/**
 * The blocks of a text that may still be growing. While it streams, finished blocks are parsed
 * once and kept; each update parses only the text after them, and the last block is repaired so
 * a half-written span or link reads as intended. A finished text is parsed whole once, so link
 * definitions and footnotes anywhere in it apply everywhere.
 */
export class BlockStream {
  private text = "";
  private done: Block[] = [];
  private doneEnd = 0;

  constructor(private readonly flavor: Flavor) {}

  update(text: string, streaming: boolean): Block[] {
    if (!streaming) {
      this.reset();
      return lex(this.flavor, text, 0).map((block) => block.render());
    }
    if (!text.startsWith(this.text.slice(0, this.doneEnd))) this.reset();
    this.text = text;
    // Footnotes are left to the finished text, where every definition is known.
    const tail = lex(this.flavor, text.slice(this.doneEnd), this.doneEnd).filter((block) => block.token.type !== "footnotes");
    const open = tail.pop();
    this.done.push(...tail.map((block) => block.render()));
    this.doneEnd = open ? open.start : text.length;
    if (!open) return [...this.done];
    const html = parsers[this.flavor].parse(repairOpenBlock(open.token.raw), { async: false });
    return [...this.done, { start: open.start, kind: open.token.type, html, open: true }];
  }

  private reset(): void {
    this.text = "";
    this.done = [];
    this.doneEnd = 0;
  }
}
