/**
 * What a finished block gets once, after it is rendered: highlighted code with a Copy button,
 * typeset math, and fenced blocks drawn by a renderer for their language (Mermaid built in, others
 * from whoever hosts the text). Libraries load the first time they are needed.
 */

/** Draws a fenced block's code into `target`; may return how to take it down again. */
export type FenceRenderer = (target: HTMLElement, code: string) => void | (() => void) | Promise<void>;

export interface EnhanceOptions {
  /** Renderers for fenced blocks by language, tried before the built-in ones. */
  fences?: (language: string) => FenceRenderer | undefined;
  /** Told whether a Copy worked, to say so. */
  onCopy?: (copied: boolean) => void;
}

const once = <T>(load: () => Promise<T>) => {
  let loading: Promise<T> | undefined;
  return () => (loading ??= load().catch((error: unknown) => ((loading = undefined), Promise.reject(error))));
};
const highlighter = once(() => import("highlight.js/lib/common").then((module) => module.default));
/** Highlighted HTML for `code` in `language`, loading the highlighter the first time. highlight.js escapes the code. */
export async function highlightCode(code: string, language: string): Promise<string> {
  const library = await highlighter();
  return library.highlight(code, { language, ignoreIllegals: true }).value;
}
const katex = once(() => Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([module]) => module.default));
const mermaid = once(() => import("mermaid").then((module) => module.default));

const dark = () => getComputedStyle(document.documentElement).colorScheme.includes("dark");
let diagrams = 0;

const builtInFences: Record<string, FenceRenderer> = {
  async mermaid(target, code) {
    const library = await mermaid();
    library.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: dark() ? "dark" : "default" });
    const { svg } = await library.render(`markdown-diagram-${++diagrams}`, code);
    target.innerHTML = svg;
    // At its own size, scrolling sideways when wider than the text, rather than shrunk unreadable.
    const drawn = target.querySelector("svg");
    if (drawn?.style.maxWidth) {
      drawn.style.width = drawn.style.maxWidth;
      drawn.removeAttribute("width");
    }
  },
  async math(target, code) {
    (await katex()).render(code, target, { displayMode: true, throwOnError: false });
  },
};
builtInFences.latex = builtInFences.math!;

const HIGHLIGHT_LIMIT = 100_000;

export function enhance(content: HTMLElement, options: EnhanceOptions = {}): () => void {
  let alive = true;
  const cleanups: (() => void)[] = [];
  const plain = (pre: HTMLElement) => {
    void highlight(pre, () => alive);
    pre.append(copyButton(pre, options.onCopy));
  };
  for (const pre of content.querySelectorAll<HTMLElement>("pre")) {
    const language = pre.dataset.lang ?? "";
    const render = (language && options.fences?.(language)) || builtInFences[language];
    if (!render) {
      plain(pre);
      continue;
    }
    const code = pre.textContent ?? "";
    const target = document.createElement("div");
    target.className = "markdown-fence";
    target.dataset.lang = language;
    pre.replaceWith(target);
    const fallback = () => {
      if (!alive) return;
      target.replaceWith(pre);
      plain(pre);
    };
    try {
      const result = render(target, code);
      if (result instanceof Promise) result.catch(fallback);
      else if (result) cleanups.push(result);
    } catch {
      fallback();
    }
  }
  for (const element of content.querySelectorAll<HTMLElement>("[data-math]")) {
    const source = element.textContent ?? "";
    void katex()
      .then((library) => alive && library.render(source, element, { displayMode: element.dataset.math === "block", throwOnError: false }))
      .catch(() => {});
  }
  return () => {
    alive = false;
    for (const cleanup of cleanups) cleanup();
  };
}

async function highlight(pre: HTMLElement, alive: () => boolean): Promise<void> {
  const language = pre.dataset.lang;
  const code = pre.querySelector("code");
  if (!language || !code || (code.textContent ?? "").length > HIGHLIGHT_LIMIT) return;
  try {
    const library = await highlighter();
    if (!alive() || !library.getLanguage(language)) return;
    // highlight.js escapes the code and adds only its own spans.
    code.innerHTML = library.highlight(code.textContent ?? "", { language, ignoreIllegals: true }).value;
  } catch {
    // Plain code is still readable.
  }
}

function copyButton(pre: HTMLElement, onCopy?: (copied: boolean) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-copy";
  button.textContent = "Copy";
  button.setAttribute("aria-label", "Copy code");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pre.querySelector("code")?.textContent ?? "");
      onCopy?.(true);
    } catch {
      onCopy?.(false);
    }
  });
  return button;
}
