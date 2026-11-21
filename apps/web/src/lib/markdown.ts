import DOMPurify from "dompurify";
import { Renderer, marked, type Token, type Tokens } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

// Links in replies open outside the app instead of replacing it.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export interface MarkdownImages {
  scope: string;
  source(href: string): string | undefined;
}

function rendererFor(images: MarkdownImages | undefined): Renderer | undefined {
  if (!images) return undefined;
  const renderer = new Renderer();
  renderer.image = ({ href, text }) => {
    const source = images.source(href);
    const label = text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
    return source ? '<a data-session-image href="' + source + '">' + label + "</a>" : label;
  };
  return renderer;
}

function sanitize(html: string, images?: MarkdownImages): string {
  const options = {
    ALLOWED_TAGS: [
      "p",
      "br",
      "hr",
      "a",
      "strong",
      "em",
      "del",
      "blockquote",
      "pre",
      "code",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    ALLOWED_ATTR: ["href", "title", "start"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  };
  if (!images || !html.includes("data-session-image")) return DOMPurify.sanitize(html, options);
  const fragment = DOMPurify.sanitize(html, { ...options, ADD_ATTR: ["data-session-image"], RETURN_DOM_FRAGMENT: true });
  for (const link of fragment.querySelectorAll("a[data-session-image]")) {
    link.removeAttribute("data-session-image");
    const source = images.source(link.getAttribute("href") ?? "");
    if (!source) continue;
    const img = document.createElement("img");
    img.alt = link.textContent ?? "";
    img.loading = "lazy";
    img.src = source;
    link.replaceChildren(img);
  }
  const wrapper = document.createElement("div");
  wrapper.append(fragment);
  return wrapper.innerHTML;
}

export function renderMarkdown(text: string, images?: MarkdownImages): string {
  if (!text?.trim()) return "";
  return sanitize(marked.parse(text, { async: false, renderer: rendererFor(images) }), images);
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
  if (((plain.match(/\*\*/g) ?? []).length) % 2 === 1) text += "**";
  const single = plain
    .replace(/\*\*/g, "")
    .replace(/^\s*[*+-]\s/gm, "")
    .match(/\*/g);
  if ((single?.length ?? 0) % 2 === 1) text += "*";
  if (/\[[^\]\n]*$/.test(text)) text = text.replace(/\[([^\]\n]*)$/, "\\[$1");
  else if (/\]\([^)\n]*$/.test(text)) text += ")";
  return text;
}

/** Finished blocks render once, whatever the reply around them does. */
const finished = new Map<string, string>();
const FINISHED_LIMIT = 500;

/**
 * A reply as one sanitized HTML string per top-level block. While `streaming`, only the last
 * block can still change: it is repaired and re-rendered each time, and every earlier block comes
 * from the cache. A finished reply renders without repairs.
 */
export function markdownBlocks(text: string, streaming = false, images?: MarkdownImages): string[] {
  if (!text?.trim()) return [];
  const tokens = marked.lexer(text);
  const last = tokens.findLastIndex((token) => token.type !== "space");
  const blocks: string[] = [];
  const renderer = rendererFor(images);
  tokens.forEach((token: Token, index) => {
    if (token.type === "space") return;
    if (streaming && index === last) {
      blocks.push(renderMarkdown(repairOpenBlock(token.raw), images));
      return;
    }
    const key = images ? images.scope + "\0" + token.raw : token.raw;
    let html = finished.get(key);
    if (html === undefined) {
      html = sanitize(
        marked.parser(Object.assign([token], { links: tokens.links }) as Tokens.Generic[] & { links: typeof tokens.links }, { renderer }),
        images,
      );
      if (finished.size >= FINISHED_LIMIT) finished.clear();
      finished.set(key, html);
    }
    blocks.push(html);
  });
  return blocks;
}
