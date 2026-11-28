import DOMPurify, { type Config } from "dompurify";

/** Where an image in the text comes from: a known address for a path the host serves, or nothing. */
export type ImageSource = (href: string) => string | undefined;

/**
 * What Markdown may produce: GitHub Markdown's elements, with nothing active. No scripts, styles,
 * classes or event handlers; links and images only to web, data or host-given addresses.
 */
const OPTIONS: Config & { RETURN_DOM_FRAGMENT: true } = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "hr",
    "a",
    "strong",
    "em",
    "del",
    "s",
    "blockquote",
    "pre",
    "code",
    "span",
    "div",
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
    "img",
    "input",
    "sub",
    "sup",
    "kbd",
    "mark",
    "details",
    "summary",
    "section",
  ],
  ALLOWED_ATTR: [
    "href",
    "title",
    "start",
    "alt",
    "src",
    "align",
    "type",
    "checked",
    "disabled",
    "open",
    "id",
    "aria-label",
    "data-lang",
    "data-math",
    "data-footnotes",
    "data-footnote-ref",
    "data-footnote-backref",
  ],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  RETURN_DOM_FRAGMENT: true,
};

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // Links open outside the app; footnote links stay in the text.
  if (node.tagName === "A" && node.hasAttribute("href") && !node.getAttribute("href")!.startsWith("#")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  // Only a task list's checkbox, and it can't be changed.
  if (node.tagName === "INPUT") {
    if (node.getAttribute("type") !== "checkbox") node.remove();
    else node.setAttribute("disabled", "");
  }
});

const WEB_IMAGE = /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|avif);)/i;

/** Images show from the web, as data, or from the host; each opens on its own when clicked. */
function placeImages(fragment: DocumentFragment, source?: ImageSource): void {
  for (const img of fragment.querySelectorAll("img")) {
    const given = img.getAttribute("src") ?? "";
    const src = source?.(given) ?? (WEB_IMAGE.test(given) ? given : undefined);
    if (!src) {
      img.replaceWith(img.alt ?? "");
      continue;
    }
    img.src = src;
    img.loading = "lazy";
    if (img.closest("a")) continue;
    const link = document.createElement("a");
    link.href = src;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    img.replaceWith(link);
    link.append(img);
  }
}

/** Footnote ids are made unique to one text, so two texts on a page don't link into each other. */
function scopeIds(fragment: DocumentFragment, scope: string): void {
  for (const element of fragment.querySelectorAll("[id]")) element.id = scope + element.id;
  for (const link of fragment.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))
    link.setAttribute("href", "#" + scope + link.getAttribute("href")!.slice(1));
}

/** Rendered Markdown as safe DOM. */
export function sanitize(html: string, options: { images?: ImageSource; scope: string }): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, OPTIONS);
  placeImages(fragment, options.images);
  scopeIds(fragment, options.scope);
  return fragment;
}
