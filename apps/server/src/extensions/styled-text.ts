import { Theme, type ThemeBg, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { StyledLine, StyledSpan } from "../protocol.js";

/**
 * Extensions style text with Pi's theme. PiSpark gives them a theme whose colors stand for a
 * few PiSpark roles, then turns the terminal escapes back into roles, so extension output
 * follows whichever PiSpark theme the browser shows.
 */
const ROLES = ["accent", "success", "warning", "danger", "muted", "subtle", "border", "selected"] as const;
type Role = (typeof ROLES)[number] | "";

const FOREGROUND: Record<ThemeColor, Role> = {
  accent: "accent",
  border: "border",
  borderAccent: "accent",
  borderMuted: "border",
  success: "success",
  error: "danger",
  warning: "warning",
  muted: "muted",
  dim: "subtle",
  text: "",
  thinkingText: "muted",
  scrollbarTrack: "border",
  scrollbarThumb: "muted",
  searchMatchText: "",
  userMessageText: "",
  customMessageText: "",
  customMessageLabel: "accent",
  toolTitle: "",
  toolOutput: "muted",
  mdHeading: "",
  mdLink: "accent",
  mdLinkUrl: "subtle",
  mdCode: "accent",
  mdCodeBlock: "",
  mdCodeBlockBorder: "border",
  mdQuote: "muted",
  mdQuoteBorder: "border",
  mdHr: "border",
  mdListBullet: "subtle",
  toolDiffAdded: "success",
  toolDiffRemoved: "danger",
  toolDiffContext: "subtle",
  syntaxComment: "subtle",
  syntaxKeyword: "accent",
  syntaxFunction: "accent",
  syntaxVariable: "",
  syntaxString: "success",
  syntaxNumber: "warning",
  syntaxType: "warning",
  syntaxOperator: "",
  syntaxPunctuation: "subtle",
  thinkingOff: "subtle",
  thinkingMinimal: "muted",
  thinkingLow: "muted",
  thinkingMedium: "accent",
  thinkingHigh: "accent",
  thinkingXhigh: "warning",
  thinkingMax: "danger",
  bashMode: "accent",
};
// PiSpark's own cards show message and tool backgrounds; extensions only keep selection and matches.
const BACKGROUND: Record<ThemeBg, Role> = {
  selectedBg: "selected",
  searchMatchBg: "warning",
  userMessageBg: "",
  customMessageBg: "",
  toolPendingBg: "",
  toolSuccessBg: "",
  toolErrorBg: "",
};

// A color no theme would pick: #01f0NN, where NN is the role's index.
const placeholder = (role: Role) =>
  role ? `#01f0${ROLES.indexOf(role).toString(16).padStart(2, "0")}` : "";
const colors = <K extends string>(roles: Record<K, Role>) =>
  Object.fromEntries(
    Object.entries<Role>(roles).map(([token, role]) => [token, placeholder(role)]),
  ) as Record<K, string>;

/** Pi's Theme styles bold/italic through chalk, which is silent without a terminal. */
class WebTheme extends Theme {
  override bold(text: string) {
    return `\x1b[1m${text}\x1b[22m`;
  }
  override italic(text: string) {
    return `\x1b[3m${text}\x1b[23m`;
  }
  override underline(text: string) {
    return `\x1b[4m${text}\x1b[24m`;
  }
  override inverse(text: string) {
    return `\x1b[7m${text}\x1b[27m`;
  }
  override strikethrough(text: string) {
    return `\x1b[9m${text}\x1b[29m`;
  }
}
export const webTheme: Theme = new WebTheme(
  colors(FOREGROUND),
  colors(BACKGROUND),
  "truecolor",
  { name: "pispark" },
);

/** Width terminal components are rendered at; the browser wraps narrower views. */
export const RENDER_WIDTH = 80;

/** The little of a TUI that render-only components use: their size and a redraw request. */
export function webTui(requestRender: () => void): TUI {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const tui = {
    terminal: { columns: RENDER_WIDTH, rows: 40 },
    requestRender: () => {
      // Animated components redraw many times a second; a few updates are enough here.
      pending ??= setTimeout(() => {
        pending = undefined;
        requestRender();
      }, 250);
    },
  };
  // SAFETY: render-only components get no input or screen; anything beyond these members throws.
  return tui as unknown as TUI;
}

const BASIC: Role[] = ["", "danger", "success", "warning", "accent", "accent", "accent", ""];
function xterm(index: number): string {
  if (index < 16) {
    const basic = [
      "000000", "cd3131", "0dbc79", "e5e510", "2472c8", "bc3fbc", "11a8cd", "e5e5e5",
      "666666", "f14c4c", "23d18b", "f5f543", "3b8eea", "d670d6", "29b8db", "ffffff",
    ];
    return `#${basic[index]}`;
  }
  if (index >= 232) {
    const gray = (8 + (index - 232) * 10).toString(16).padStart(2, "0");
    return `#${gray}${gray}${gray}`;
  }
  const cube = index - 16;
  const level = (n: number) => (n ? 55 + n * 40 : 0).toString(16).padStart(2, "0");
  return `#${level(Math.floor(cube / 36))}${level(Math.floor(cube / 6) % 6)}${level(cube % 6)}`;
}
function rgb(r: number, g: number, b: number): string {
  if (r === 1 && g === 0xf0 && ROLES[b]) return ROLES[b];
  return `#${[r, g, b].map((n) => (n & 255).toString(16).padStart(2, "0")).join("")}`;
}

type Style = Omit<StyledSpan, "text"> & { inverse?: true };
const MAX_LINES = 200;
const MAX_WIDTH = 400;
// SGR, other CSI, OSC 8 links, other OSC/APC strings, other escapes, control characters.
const TOKENS =
  /\x1b\[([0-9;:]*)m|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b[\]_P^][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b-\x1f\x7f]/g;

function applySgr(style: Style, params: string): Style {
  const codes = params.split(/[;:]/).map((code) => (code === "" ? 0 : Number(code)));
  const next: Style = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (code === 0) for (const key of Object.keys(next)) delete next[key as keyof Style];
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 9) next.strike = true;
    else if (code === 21 || code === 22) {
      delete next.bold;
      delete next.dim;
    }
    else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 27) delete next.inverse;
    else if (code === 29) delete next.strike;
    else if (code >= 30 && code <= 37) next.fg = BASIC[code - 30] || undefined;
    else if (code >= 90 && code <= 97) next.fg = code === 90 ? "subtle" : BASIC[code - 90] || undefined;
    else if (code === 39) delete next.fg;
    else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) next.bg = "selected";
    else if (code === 49) delete next.bg;
    else if (code === 38 || code === 48) {
      const slot = code === 38 ? "fg" : "bg";
      if (codes[i + 1] === 5) {
        next[slot] = xterm(codes[i + 2] ?? 0);
        i += 2;
      } else if (codes[i + 1] === 2) {
        next[slot] = rgb(codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0);
        i += 4;
      }
    }
    if (!next.fg) delete next.fg;
  }
  return next;
}

function span(text: string, style: Style): StyledSpan {
  const { inverse, ...rest } = style;
  return inverse ? { text, ...rest, bg: "selected" } : { text, ...rest };
}
const sameStyle = (a: StyledSpan, b: StyledSpan) =>
  JSON.stringify({ ...a, text: "" }) === JSON.stringify({ ...b, text: "" });

/** Terminal text (one string with newlines, or rendered lines) as styled lines. */
export function styledLines(input: string | readonly string[]): StyledLine[] {
  const text = typeof input === "string" ? input : input.join("\n");
  const lines: StyledLine[] = [[]];
  let style: Style = {};
  let link: string | undefined;
  let width = 0;
  const push = (chunk: string) => {
    for (const [index, part] of chunk.split("\n").entries()) {
      if (index > 0) {
        if (lines.length >= MAX_LINES) return;
        lines.push([]);
        width = 0;
      }
      const room = MAX_WIDTH - width;
      if (!part || room <= 0) continue;
      const clipped = part.length > room ? `${part.slice(0, room - 1)}…` : part;
      width += clipped.length;
      const next = span(clipped, link ? { ...style, link } : style);
      const line = lines.at(-1)!;
      const last = line.at(-1);
      if (last && sameStyle(last, next)) last.text += clipped;
      else line.push(next);
    }
  };
  let cursor = 0;
  for (const match of text.matchAll(TOKENS)) {
    push(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) style = applySgr(style, match[1]);
    else if (match[2] !== undefined) link = /^https?:\/\//.test(match[2]) ? match[2] : undefined;
    else if (match[0] === "\t") push("  ");
  }
  push(text.slice(cursor));
  return lines;
}

const plainText = (line: StyledLine) => line.map((s) => s.text).join("");

/** Rendered components: no trailing spaces, no blank edges, no shared indentation. */
export function tidy(lines: StyledLine[]): StyledLine[] {
  const trimmed = lines.map((line) => {
    const copy = line.map((s) => ({ ...s }));
    while (copy.length && !copy.at(-1)!.bg && !copy.at(-1)!.text.trimEnd()) copy.pop();
    const last = copy.at(-1);
    if (last && !last.bg) last.text = last.text.trimEnd();
    return copy;
  });
  while (trimmed.length && !plainText(trimmed[0]!)) trimmed.shift();
  while (trimmed.length && !plainText(trimmed.at(-1)!)) trimmed.pop();
  const indents = trimmed
    .filter((line) => plainText(line))
    .map((line) => plainText(line).length - plainText(line).trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 0;
  if (!indent) return trimmed;
  return trimmed.map((line) => {
    let remove = indent;
    const out: StyledLine = [];
    for (const s of line) {
      if (remove > 0) {
        const cut = Math.min(remove, s.text.length);
        remove -= cut;
        if (cut < s.text.length) out.push({ ...s, text: s.text.slice(cut) });
      } else out.push(s);
    }
    return out;
  });
}

/** An extension's terminal component as tidy styled lines; a failing render shows nothing. */
export function renderComponent(
  create: () => Component | undefined,
): StyledLine[] | undefined {
  try {
    const component = create();
    if (!component) return undefined;
    const lines = tidy(styledLines(component.render(RENDER_WIDTH)));
    return lines.length ? lines : undefined;
  } catch {
    return undefined;
  }
}
