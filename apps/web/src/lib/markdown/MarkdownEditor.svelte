<script lang="ts">
  /**
   * Markdown with a Preview / Edit switch. Preview draws it as PiSpark draws any Markdown. Edit is
   * the whole text as written, with its Markdown
   * highlighted: what you type is the file, line endings included. Read-only, it is the preview
   * alone. Nothing here knows what the text is for.
   */
  import { tick } from "svelte";
  import Segmented from "../ui/Segmented.svelte";
  import { FRONT_MATTER, lineEndings, sourceBlocks } from "./blocks";
  import { enhance, highlightCode } from "./enhance";
  import { escapeHtml } from "./parse";
  import { patch } from "./patch";
  import { sanitize } from "./sanitize";
  import type { MarkdownOptions } from "./view";

  let {
    value = $bindable(""),
    label,
    editable = true,
    mode = $bindable("preview"),
    placeholder = "",
    tone = "plain",
    frontmatter = "shown",
    options = {},
    onchange,
  }: {
    value?: string;
    /** What the text is, for assistive technology: "SKILL.md", "Instruction tone"… */
    label: string;
    editable?: boolean;
    mode?: "preview" | "edit";
    /** Said when there is no text yet. */
    placeholder?: string;
    /** "quiet" sits on a muted ground, for text that is shown rather than worked on. */
    tone?: "plain" | "quiet";
    /** Front matter is always kept and edited as written; "hidden" leaves it out of the preview. */
    frontmatter?: "shown" | "hidden";
    options?: MarkdownOptions;
    onchange?: (value: string) => void;
  } = $props();

  const id = $props.id();
  const flavor = $derived(options.flavor ?? "prose");
  const text = $derived(lineEndings(value));
  const editing = $derived(editable && mode === "edit");
  const blocks = $derived(sourceBlocks(text.lf, flavor));
  const shown = $derived(frontmatter === "hidden" ? blocks.filter((block) => block.kind !== "frontmatter") : blocks);

  // The source, highlighted once the highlighter has loaded; plain until then.
  let highlighted = $state("");
  $effect(() => {
    if (!editing) return;
    const source = text.lf;
    let current = true;
    // Front matter is data, not Markdown: highlight.js would read its closing --- as a heading rule.
    const front = FRONT_MATTER.exec(source)?.[0] ?? "";
    const meta = front ? `<span class="hljs-meta">${escapeHtml(front)}</span>` : "";
    highlighted = escapeHtml(source);
    highlightCode(source.slice(front.length), "markdown").then(
      (html) => current && (highlighted = meta + html),
      () => undefined,
    );
    return () => (current = false);
  });

  let field = $state<HTMLTextAreaElement>();
  function input(event: Event) {
    // A textarea gives plain line endings; the file keeps its own.
    value = text.restore((event.currentTarget as HTMLTextAreaElement).value);
    onchange?.(value);
  }
  async function write() {
    mode = "edit";
    await tick();
    field?.focus();
  }

  /** A block's HTML, sanitized, drawn and enhanced like any Markdown in PiSpark. */
  function render(node: HTMLElement, html: string) {
    let cleanup: (() => void) | undefined;
    const draw = (next: string) => {
      cleanup?.();
      patch(node, sanitize(next, { images: options.images, scope: `${id}-` }));
      cleanup = enhance(node, options);
    };
    draw(html);
    return { update: draw, destroy: () => cleanup?.() };
  }
</script>

<div class="markdown-editor" data-tone={tone} data-mode={editing ? "edit" : "preview"}>
  {#if editable}
    <div class="bar">
      <Segmented
        label={`Show ${label} as`}
        options={[
          { value: "preview", label: "Preview" },
          { value: "edit", label: "Edit" },
        ]}
        bind:value={mode}
      />
    </div>
  {/if}
  {#if editing}
    <div class="source">
      <pre aria-hidden="true"><code class="hljs">{@html highlighted}{"\n"}</code></pre>
      <textarea
        bind:this={field}
        value={text.lf}
        oninput={input}
        aria-label={`${label}, Markdown`}
        spellcheck="false"
        autocapitalize="off"
        placeholder={placeholder || "Write Markdown…"}
      ></textarea>
    </div>
  {:else if shown.length}
    <div class="preview prose max-w-none" role="group" aria-label={label}>
      {#each shown as block (block.start)}
        <div class="block">
          {#if block.kind === "frontmatter" || !block.html.trim()}
            <pre class="raw">{block.source}</pre>
          {:else}
            <div use:render={block.html}></div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <div class="skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
      {#if placeholder}<p>{placeholder}</p>{/if}
      {#if editable}<button type="button" class="ui-button" data-size="compact" onclick={() => void write()}>Write it</button>{/if}
    </div>
  {/if}
</div>

<style>
  .markdown-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 0.875rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
  }
  .markdown-editor[data-tone="quiet"] {
    border-color: transparent;
    background: color-mix(in srgb, var(--muted) 55%, var(--background));
  }
  .bar {
    display: flex;
    justify-content: flex-end;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .block {
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-reading);
    font-size: var(--text-base);
  }
  .block :global(> div > :first-child) {
    margin-top: 0;
  }
  .block :global(> div > :last-child) {
    margin-bottom: 0;
  }
  .block .raw {
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  /* The text box lies over its highlighted copy: same font, size, padding and wrapping. */
  .source {
    display: grid;
    border-radius: var(--radius-sm);
  }
  .source > * {
    grid-area: 1 / 1;
    margin: 0;
    padding: 0.25rem 0.5rem;
    border: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.6;
    tab-size: 4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .source pre {
    background: none;
    pointer-events: none;
    color: var(--foreground);
  }
  .source pre code {
    padding: 0;
    background: none;
    font: inherit;
  }
  /* Colour only: a heavier or slanted glyph would move the caret off its letter. */
  .source pre :global(.hljs-section) {
    color: var(--interactive-text);
  }
  .source pre :global(.hljs-bullet),
  .source pre :global(.hljs-quote) {
    color: var(--accent-text);
  }
  .source pre :global(.hljs-code) {
    color: var(--success-foreground);
  }
  .source pre :global(.hljs-string) {
    color: var(--interactive-text);
  }
  .source pre :global(.hljs-link),
  .source pre :global(.hljs-symbol),
  .source pre :global(.hljs-meta) {
    color: var(--muted-foreground);
  }
  .source pre :global(.hljs-strong),
  .source pre :global(.hljs-emphasis) {
    color: var(--warning-foreground);
  }
  textarea {
    resize: none;
    overflow: hidden;
    min-height: 6rem;
    background: transparent;
    color: transparent;
    caret-color: var(--foreground);
    border-radius: var(--radius-sm);
  }
  textarea::placeholder {
    color: var(--muted-foreground);
  }
  textarea::selection {
    background: color-mix(in srgb, var(--ring) 30%, transparent);
    color: transparent;
  }
  textarea:focus {
    outline: none;
  }
  .source:focus-within {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 35%, transparent);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.25rem 0.5rem;
  }
  .empty p {
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .skeleton {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .skeleton span {
    height: 0.5625rem;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--muted) 90%, var(--foreground) 4%);
  }
  .skeleton span:nth-child(1) {
    width: 38%;
  }
  .skeleton span:nth-child(2) {
    width: 86%;
  }
  .skeleton span:nth-child(3) {
    width: 64%;
  }
</style>
