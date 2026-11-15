<script lang="ts" module>
  /** One piece of a rich input's value: text, or a token shown as a chip inside the text. */
  export type RichPiece = string | { token: string };
  /** How a token looks. The control knows nothing else about it; the feature decides what it means. */
  export interface RichToken {
    /** Shown in the chip (a file name, a person, a command). */
    label: string;
    /** Smaller text after the label (a size). */
    detail?: string;
    /** A picture shown instead of the label (an image's thumbnail); the label becomes its description. */
    thumbnail?: string;
    /** Still being prepared (an upload), with progress from 0 to 1 when known; or it failed. */
    state?: "working" | "failed";
    progress?: number;
    /** Said by screen readers and shown on hover. */
    description: string;
  }
  /** The value as plain pieces, merging neighbouring text. */
  export function normalizePieces(pieces: RichPiece[]): RichPiece[] {
    const out: RichPiece[] = [];
    for (const piece of pieces) {
      if (typeof piece === "string") {
        if (!piece) continue;
        if (typeof out[out.length - 1] === "string") out[out.length - 1] += piece;
        else out.push(piece);
      } else out.push(piece);
    }
    return out;
  }
</script>

<script lang="ts">
  /**
   * A text field where tokens sit inside the text as chips: they move with the text, are selected and
   * deleted like one character, and keep their place. Files pasted or dropped are handed to `onfiles`,
   * which answers the tokens to insert where they landed. Enter submits; Shift+Enter starts a new line.
   */
  let {
    value,
    tokens,
    label,
    placeholder = "",
    maxlength = 65536,
    onchange,
    onfiles,
    onsubmit,
    onremove,
    class: className = "",
  }: {
    value: RichPiece[];
    tokens: Readonly<Record<string, RichToken>>;
    label: string;
    placeholder?: string;
    maxlength?: number;
    onchange: (value: RichPiece[]) => void;
    /** Files arrived by paste, drop or `insertFiles`; answer the ids of the tokens to place. */
    onfiles?: (files: File[]) => string[];
    onsubmit?: () => void;
    /** A token left the text (deleted, cut, or its × pressed). */
    onremove?: (id: string) => void;
    class?: string;
  } = $props();

  let editor: HTMLDivElement;
  let shown = "";
  const key = (pieces: RichPiece[]) => JSON.stringify(normalizePieces(pieces));

  /** Inserts files where the cursor is (an attach button calls this). */
  export function insertFiles(files: File[]) {
    if (!files.length || !onfiles) return;
    insertTokens(onfiles(files));
  }
  export function focus() {
    editor.focus();
  }

  function chip(id: string): HTMLElement {
    const node = document.createElement("span");
    node.className = "rich-token";
    node.contentEditable = "false";
    node.dataset.token = id;
    node.setAttribute("role", "img");
    paint(node, tokens[id]);
    return node;
  }
  function paint(node: HTMLElement, token: RichToken | undefined) {
    const id = node.dataset.token!;
    const t = token ?? { label: id, description: id };
    node.replaceChildren();
    node.dataset.state = t.state ?? "ready";
    node.classList.toggle("rich-token-picture", Boolean(t.thumbnail));
    node.setAttribute("aria-label", t.description);
    node.title = t.description;
    if (t.thumbnail) {
      const img = document.createElement("img");
      img.src = t.thumbnail;
      img.alt = "";
      node.append(img);
    } else {
      const name = document.createElement("span");
      name.className = "rich-token-label";
      name.textContent = t.label;
      node.append(name);
      if (t.detail) {
        const detail = document.createElement("span");
        detail.className = "rich-token-detail";
        detail.textContent = t.detail;
        node.append(detail);
      }
    }
    if (t.state === "working") {
      const bar = document.createElement("span");
      bar.className = "rich-token-progress";
      bar.style.setProperty("--progress", String(Math.round((t.progress ?? 0) * 100)));
      node.append(bar);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rich-token-remove";
    remove.tabIndex = -1;
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${t.label}`);
    remove.addEventListener("mousedown", (event) => event.preventDefault());
    remove.addEventListener("click", () => {
      node.remove();
      emit();
      editor.focus();
    });
    node.append(remove);
  }

  /** The pieces the editor shows now. */
  function read(): RichPiece[] {
    const pieces: RichPiece[] = [];
    const walk = (parent: Node, top: boolean) => {
      parent.childNodes.forEach((node, index) => {
        if (node.nodeType === Node.TEXT_NODE) pieces.push((node.textContent ?? "").replace(/ /g, " "));
        else if (node instanceof HTMLElement && node.dataset.token) pieces.push({ token: node.dataset.token });
        else if (node.nodeName === "BR") {
          // A browser keeps a lone trailing <br> to show an empty last line; it is not a character.
          if (!(top && index === parent.childNodes.length - 1)) pieces.push("\n");
        } else if (node instanceof HTMLElement) {
          // Pasted or typed blocks become lines.
          if (pieces.length && /^(DIV|P)$/.test(node.nodeName)) pieces.push("\n");
          walk(node, false);
        }
      });
    };
    walk(editor, true);
    return normalizePieces(pieces);
  }
  /** Shows `pieces`, replacing what is there. */
  function render(pieces: RichPiece[]) {
    editor.replaceChildren(
      ...normalizePieces(pieces).map((piece) => (typeof piece === "string" ? document.createTextNode(piece) : chip(piece.token))),
    );
    shown = key(pieces);
    editor.dataset.empty = String(!editor.textContent && !editor.querySelector("[data-token]"));
  }
  let present = new Set<string>();
  function emit() {
    const pieces = read();
    shown = key(pieces);
    editor.dataset.empty = String(!pieces.length);
    const now = new Set(pieces.flatMap((piece) => (typeof piece === "string" ? [] : [piece.token])));
    for (const id of present) if (!now.has(id)) onremove?.(id);
    present = now;
    onchange(pieces);
  }

  // A value set from outside (a cleared draft, another session's draft) replaces the editor's content.
  $effect(() => {
    const next = key(value);
    if (next !== shown) {
      render(value);
      present = new Set(value.flatMap((piece) => (typeof piece === "string" ? [] : [piece.token])));
    }
  });
  // Tokens change in place (an upload's progress, a thumbnail) without touching the text.
  $effect(() => {
    // Read the tokens first, so the effect follows them even while no chip is shown.
    const current = tokens;
    for (const node of editor.querySelectorAll<HTMLElement>("[data-token]")) paint(node, current[node.dataset.token!]);
  });

  function caretRange(): Range {
    const selection = getSelection();
    if (selection?.rangeCount && editor.contains(selection.anchorNode)) return selection.getRangeAt(0);
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }
  function insertTokens(ids: string[]) {
    if (!ids.length) return;
    editor.focus();
    const range = caretRange();
    range.deleteContents();
    for (const id of ids) {
      const node = chip(id);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
    }
    // A space after the last chip gives the cursor somewhere to stand.
    const space = document.createTextNode(" ");
    range.insertNode(space);
    range.setStartAfter(space);
    range.collapse(true);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    emit();
  }
  function insertText(text: string) {
    const length = read().reduce((sum, piece) => sum + (typeof piece === "string" ? piece.length : 1), 0);
    const room = Math.max(0, maxlength - length);
    // execCommand keeps the browser's own undo for typed and pasted text.
    document.execCommand("insertText", false, text.slice(0, room));
  }

  function onpaste(event: ClipboardEvent) {
    event.preventDefault();
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length && onfiles) insertTokens(onfiles(files));
    else insertText(event.clipboardData?.getData("text/plain") ?? "");
  }
  let dragging = $state(false);
  function ondrop(event: DragEvent) {
    dragging = false;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length || !onfiles) return;
    event.preventDefault();
    // Place the files where they were dropped.
    const at = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(
      event.clientX,
      event.clientY,
    );
    if (at && editor.contains(at.startContainer)) {
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(at);
    }
    insertTokens(onfiles(files));
  }
  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      onsubmit?.();
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      document.execCommand("insertLineBreak");
    }
  }
</script>

<div
  bind:this={editor}
  class={"rich-input " + className}
  class:rich-input-dragging={dragging}
  contenteditable="true"
  role="textbox"
  tabindex="0"
  aria-multiline="true"
  aria-label={label}
  aria-placeholder={placeholder}
  data-placeholder={placeholder}
  data-empty="true"
  spellcheck="true"
  oninput={emit}
  {onpaste}
  {onkeydown}
  ondragover={(event) => {
    if (onfiles && event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
      dragging = true;
    }
  }}
  ondragleave={() => (dragging = false)}
  {ondrop}
></div>

<style>
  .rich-input {
    min-height: 1.5rem;
    max-height: 12rem;
    overflow-y: auto;
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.75rem;
    cursor: text;
  }
  .rich-input[data-empty="true"]::before {
    content: attr(data-placeholder);
    color: var(--muted-foreground);
    pointer-events: none;
  }
  .rich-input-dragging {
    background: color-mix(in srgb, var(--interactive) 6%, transparent);
    border-radius: 0.5rem;
  }
  .rich-input :global(.rich-token) {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    height: 1.5rem;
    max-width: 15rem;
    margin: 0 0.125rem;
    padding: 0 0.375rem;
    vertical-align: middle;
    border: 1px solid var(--border);
    border-radius: 0.4375rem;
    background: var(--muted);
    font-size: 0.8125rem;
    line-height: 1.5;
    white-space: nowrap;
    user-select: all;
  }
  .rich-input :global(.rich-token-picture) {
    padding: 0.125rem;
    height: 1.75rem;
  }
  .rich-input :global(.rich-token img) {
    display: block;
    height: 1.4rem;
    max-width: 3rem;
    border-radius: 0.3rem;
    object-fit: cover;
  }
  .rich-input :global(.rich-token-label) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rich-input :global(.rich-token-detail) {
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }
  .rich-input :global(.rich-token[data-state="failed"]) {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    background: color-mix(in srgb, var(--danger) 8%, var(--background));
  }
  .rich-input :global(.rich-token[data-state="failed"] .rich-token-detail) {
    color: var(--danger-foreground, var(--danger));
  }
  .rich-input :global(.rich-token-progress) {
    position: absolute;
    left: 0.25rem;
    right: 0.25rem;
    bottom: 0.125rem;
    height: 2px;
    border-radius: 1px;
    background: linear-gradient(
      to right,
      var(--interactive) calc(var(--progress) * 1%),
      var(--border) calc(var(--progress) * 1%)
    );
  }
  .rich-input :global(.rich-token-remove) {
    display: none;
    border: 0;
    background: transparent;
    padding: 0 0.125rem;
    color: var(--muted-foreground);
    cursor: pointer;
    font-size: 0.875rem;
    line-height: 1;
  }
  .rich-input :global(.rich-token:hover .rich-token-remove),
  .rich-input :global(.rich-token[data-state="failed"] .rich-token-remove) {
    display: inline;
  }
  .rich-input :global(.rich-token-picture .rich-token-remove) {
    position: absolute;
    top: -0.45rem;
    right: -0.45rem;
    width: 1.05rem;
    height: 1.05rem;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--background);
    font-size: 0.75rem;
  }
</style>
