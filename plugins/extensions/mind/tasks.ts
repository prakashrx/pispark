import { createHash } from "node:crypto";
import { TASK_HEADINGS } from "./layout.js";

/**
 * Reading and the few mechanical edits of `tasks.md`: its entries, the questions waiting on the
 * person, writing their answer under a question, and keeping "Done lately" short. Pure text.
 */

export interface Entry {
  /** The section it is under, as in `TASK_HEADINGS`. */
  section: string;
  /** Its first and last line numbers in the document. */
  first: number;
  last: number;
  /** The bullet's own text, without the "- ". */
  text: string;
  /** The indented lines under it. */
  detail: string[];
}

const plain = (text: string) => text.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
const split = (content: string) => content.replace(/\r\n?/g, "\n").split("\n");

export function entries(content: string): Entry[] {
  const found: Entry[] = [];
  let section = "";
  let open: Entry | undefined;
  let code = false;
  split(content).forEach((line, index) => {
    const fence = /^\s*(```|~~~)/.test(line);
    if (!code && !fence && /^## /.test(line)) {
      const name = plain(line.slice(3)).toLowerCase();
      section = TASK_HEADINGS.find((h) => h.toLowerCase() === name) ?? "";
      open = undefined;
    } else if (!code && !fence && section && line.startsWith("- ")) {
      open = { section, first: index, last: index, text: line.slice(2).trim(), detail: [] };
      found.push(open);
    } else if (open && line.trim()) {
      open.detail.push(line);
      open.last = index;
    }
    if (fence) code = !code;
  });
  return found;
}

export interface Question {
  /** Stable while the question's own line doesn't change. */
  id: string;
  /** The question as written: what is asked, the recommendation, what happens meanwhile. */
  text: string;
  detail: string;
  /** What the person answered, once they have. */
  answer?: string;
}

const ANSWER = /^\s+- Answer \(\d{4}-\d{2}-\d{2}\): (.*)$/;
const idOf = (text: string) => createHash("sha1").update(plain(text.replace(/[*_`]/g, "")).toLowerCase()).digest("hex").slice(0, 8);

/** The entries under "Waiting on you". */
export function questions(content: string): Question[] {
  return entries(content)
    .filter((entry) => entry.section === "Waiting on you")
    .map((entry) => {
      const answer = entry.detail.map((line) => ANSWER.exec(line)?.[1]).find((value) => value !== undefined);
      return {
        id: idOf(entry.text),
        text: entry.text,
        detail: entry.detail.filter((line) => !ANSWER.test(line)).map((line) => line.trim()).join("\n"),
        ...(answer !== undefined ? { answer } : {}),
      };
    });
}

/** The document with the person's answer written under that question, or nothing if it is not there. */
export function withAnswer(content: string, id: string, answer: string, date: string): string | undefined {
  const entry = entries(content).find((each) => each.section === "Waiting on you" && idOf(each.text) === id);
  if (!entry) return undefined;
  const all = split(content);
  all.splice(entry.last + 1, 0, `  - Answer (${date}): ${plain(answer)}`);
  return all.join("\n");
}

/** The document with only the newest `keep` lines under "Done lately". The sessions keep the rest. */
export function trimDone(content: string, keep: number): string {
  const done = entries(content).filter((entry) => entry.section === "Done lately");
  if (done.length <= keep) return content;
  const drop = new Set(
    [...done]
      .sort((a, b) => b.text.slice(0, 10).localeCompare(a.text.slice(0, 10)) || a.first - b.first)
      .slice(keep)
      .flatMap((entry) => Array.from({ length: entry.last - entry.first + 1 }, (_, i) => entry.first + i)),
  );
  return split(content).filter((_, index) => !drop.has(index)).join("\n");
}

/** One section's own Markdown, without its heading. */
export function section(content: string, heading: string): string {
  const all = split(content);
  const start = all.findIndex((line) => /^## /.test(line) && plain(line.slice(3)).toLowerCase() === heading.toLowerCase());
  if (start < 0) return "";
  const end = all.findIndex((line, index) => index > start && /^## /.test(line));
  return all.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

/** A question as one line of plain text, for a notification or a dialog title. */
export const spoken = (text: string) => plain(text.replace(/\*\*/g, ""));

/** Just the question: its bold part, else up to its question mark, else its first words. */
export function headline(text: string): string {
  const bold = /\*\*(.+?)\*\*/.exec(text)?.[1];
  if (bold) return spoken(bold);
  const said = spoken(text);
  const mark = said.indexOf("?");
  return mark > 0 && mark < 200 ? said.slice(0, mark + 1) : said.length > 120 ? `${said.slice(0, 117)}…` : said;
}
