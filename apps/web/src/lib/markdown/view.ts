import { enhance, type EnhanceOptions } from "./enhance";
import { BlockStream, type Block, type Flavor } from "./parse";
import { patch } from "./patch";
import { sanitize, type ImageSource } from "./sanitize";

export interface MarkdownOptions extends EnhanceOptions {
  /** "typed" keeps single line breaks, for text a person typed; "prose" is Markdown as written. */
  flavor?: Flavor;
  /** Addresses for images the host serves (for example a session's own files). */
  images?: ImageSource;
}

/** One block on the page: our frame, the sanitized content inside it, and what enhanced it. */
interface Shown {
  frame: HTMLElement;
  html: string;
  open: boolean;
  cleanup?: () => void;
}

let views = 0;

/**
 * Markdown drawn into an element and kept current as the text grows. Each block is its own frame,
 * keyed by where it starts: finished blocks are never touched again, the open one is patched in
 * place, and updates are drawn at most once per frame. A finished block is enhanced once.
 */
export class MarkdownView {
  private readonly blocks = new Map<number, Shown>();
  private readonly stream: BlockStream;
  private readonly scope = `md${++views}-`;
  private next?: { text: string; streaming: boolean };
  private drawn?: { text: string; streaming: boolean };
  private frame = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: MarkdownOptions = {},
  ) {
    this.stream = new BlockStream(options.flavor ?? "prose");
  }

  /** Shows `text`; the first time at once, then once per animation frame. */
  update(text: string, streaming = false): void {
    if (this.drawn?.text === text && this.drawn.streaming === streaming) {
      this.next = undefined;
      return;
    }
    this.next = { text, streaming };
    if (!this.blocks.size) this.draw();
    else this.frame ||= requestAnimationFrame(() => this.draw());
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    for (const shown of this.blocks.values()) shown.cleanup?.();
    this.blocks.clear();
    this.root.replaceChildren();
  }

  private draw(): void {
    this.frame = 0;
    if (!this.next) return;
    const { text, streaming } = this.next;
    this.drawn = this.next;
    this.next = undefined;
    const blocks = text.trim() ? this.stream.update(text, streaming) : [];
    const keep = new Set(blocks.map((block) => block.start));
    for (const [start, shown] of this.blocks)
      if (!keep.has(start)) {
        shown.cleanup?.();
        shown.frame.remove();
        this.blocks.delete(start);
      }
    let before: ChildNode | null = this.root.firstChild;
    for (const block of blocks) {
      const shown = this.show(block);
      if (shown.frame !== before) this.root.insertBefore(shown.frame, before);
      before = shown.frame.nextSibling;
    }
  }

  private show(block: Block): Shown {
    let shown = this.blocks.get(block.start);
    if (!shown) {
      shown = { frame: document.createElement("div"), html: "", open: true };
      this.blocks.set(block.start, shown);
    }
    frame(shown.frame, block.kind);
    if (shown.html !== block.html) {
      shown.cleanup?.();
      shown.cleanup = undefined;
      patch(shown.frame, sanitize(block.html, { images: this.options.images, scope: this.scope }));
      shown.html = block.html;
    }
    shown.open = !!block.open;
    if (!shown.open && !shown.cleanup) shown.cleanup = enhance(shown.frame, this.options);
    return shown;
  }
}

/** A table scrolls sideways on its own and can be reached by keyboard; prose keeps a reading width. */
function frame(element: HTMLElement, kind: string): void {
  const table = kind === "table";
  element.className = table ? "table-scroll" : "reading-block";
  if (table) {
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", "Table");
    element.tabIndex = 0;
  } else {
    element.removeAttribute("role");
    element.removeAttribute("aria-label");
    element.removeAttribute("tabindex");
  }
}
