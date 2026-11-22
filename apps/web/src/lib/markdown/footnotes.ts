import type { MarkedExtension, Token, Tokens } from "marked";

const escapeId = (id: string) => id.replace(/[^\w-]/g, "_");

interface Note extends Tokens.Generic {
  id: string;
  tokens: Token[];
}

/**
 * GitHub footnotes: `[^id]` where it is cited, `[^id]: text` anywhere; the notes are listed at
 * the end, each linking back. Kept stateless, so one parser can serve many texts.
 */
export const footnotes: MarkedExtension = {
  extensions: [
    {
      name: "footnote",
      level: "block",
      start: (src) => src.match(/^\[\^[^\]\s]+\]:/m)?.index,
      tokenizer(src) {
        const match = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/.exec(src);
        if (!match) return;
        return { type: "footnote", raw: match[0], id: match[1]!, tokens: this.lexer.inlineTokens(match[2]!.replace(/\n(?: {2,}|\t)/g, "\n")) };
      },
      // A note is drawn in the list at the end, not where it is defined.
      renderer: () => "",
    },
    {
      name: "footnoteRef",
      level: "inline",
      start: (src) => src.match(/\[\^/)?.index,
      tokenizer(src) {
        const match = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
        if (match) return { type: "footnoteRef", raw: match[0], id: match[1]! };
      },
      renderer: (token) => {
        const id = escapeId(token.id as string);
        return `<sup><a href="#footnote-${id}" id="footnote-ref-${id}" data-footnote-ref>${id}</a></sup>`;
      },
    },
    {
      name: "footnotes",
      level: "block",
      tokenizer: () => undefined,
      renderer(token) {
        const items = (token.notes as Note[]).map((note) => {
          const id = escapeId(note.id);
          return `<li id="footnote-${id}">${this.parser.parseInline(note.tokens)} <a href="#footnote-ref-${id}" data-footnote-backref aria-label="Back to the text">↩</a></li>`;
        });
        return `<section data-footnotes><ol>${items.join("")}</ol></section>\n`;
      },
    },
  ],
};

/** The notes of a whole text, as one block to put after it (none when it has no notes). */
export function noteList(tokens: Token[]): Token | undefined {
  const notes = tokens.filter((token): token is Note => token.type === "footnote");
  return notes.length ? ({ type: "footnotes", raw: "", notes } as Tokens.Generic) : undefined;
}
