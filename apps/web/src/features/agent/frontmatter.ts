/**
 * The few front-matter fields the agent page edits (a skill's name and description, a prompt's
 * description and argument hint), changed line by line so the rest of the file stays as written.
 */
const BLOCK = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;

/** One field's value: a plain line, or a folded (`>`) or literal (`|`) block joined with spaces. */
export function fieldOf(text: string, key: string): string {
  const block = BLOCK.exec(text)?.[2];
  if (!block) return "";
  const lines = block.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (at < 0) return "";
  const value = lines[at]!.slice(key.length + 1).trim();
  if (!/^[>|]-?$/.test(value)) return unquote(value);
  const more: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (!/^\s/.test(line)) break;
    more.push(line.trim());
  }
  return more.join(" ");
}

/** The text with one field set to `value` on a single line, added if missing. */
export function withField(text: string, key: string, value: string): string {
  const line = `${key}: ${quote(value)}`;
  const match = BLOCK.exec(text);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  if (!match) return `---${newline}${line}${newline}---${newline}${newline}${text}`;
  const lines = match[2]!.split(/\r?\n/);
  const at = lines.findIndex((entry) => entry.startsWith(`${key}:`));
  if (at < 0) lines.push(line);
  else {
    let end = at + 1;
    if (/^[>|]-?$/.test(lines[at]!.slice(key.length + 1).trim())) while (end < lines.length && /^\s/.test(lines[end]!)) end++;
    lines.splice(at, end - at, line);
  }
  return match[1] + lines.join(newline) + match[3] + text.slice(match[0].length);
}

/** The argument names a prompt's hint gives: `<version> [since]` → version, since. */
export function argumentNames(hint: string): string[] {
  return [...hint.matchAll(/[<[]([^>\]]+)[>\]]/g)].map((m) => m[1]!.trim());
}

const unquote = (value: string) => (/^(["']).*\1$/.test(value) ? value.slice(1, -1) : value);
/** Quoted only when YAML would read it otherwise. */
const quote = (value: string) => (/^[\s"'[{>|*&!%@`#]|: |\s#|\s$/.test(value) || value === "" ? JSON.stringify(value) : value);
