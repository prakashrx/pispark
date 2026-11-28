<script lang="ts">
  /**
   * The layout the Markdown kinds share (instructions, skills, prompts): a list on the left, the
   * open one on the right. On a phone it's the list until you open one, then that one with a way
   * back. Each kind draws its own rows and detail; this only places them, so the three tabs move
   * the same way. Rows use `split-name` and `split-desc` for their two lines.
   */
  import type { Snippet } from "svelte";
  import { tick } from "svelte";
  import BackButton from "./BackButton.svelte";
  import { keyOf, type Row } from "./agent-page.svelte";

  let {
    items,
    selected,
    narrow,
    label,
    onselect,
    row,
    detail,
    top,
    showing = !!selected,
    off,
  }: {
    items: Row[];
    selected?: Row;
    narrow: boolean;
    /** The list's name, also the back button's text. */
    label: string;
    onselect: (item: Row | undefined) => void;
    row: Snippet<[Row]>;
    detail: Snippet;
    /** Rows above the items that aren't items (instructions' "Everything, in order"). */
    top?: Snippet;
    /** Something is open on the right (an item, or what a top row opened). */
    showing?: boolean;
    /** Whether a row is switched off, shown muted. */
    off?: (item: Row) => boolean;
  } = $props();

  let list: HTMLElement | undefined = $state();
  let root: HTMLElement | undefined = $state();

  async function pick(item: Row) {
    onselect(item);
    await tick();
    root?.querySelector<HTMLElement>(".split-detail h2")?.focus();
  }
  async function back() {
    const was = selected;
    onselect(undefined);
    await tick();
    (was
      ? list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(keyOf(was))}"]`)
      : list?.querySelector<HTMLElement>("button")
    )?.focus();
  }
</script>

<div class="split" data-narrow={narrow || undefined} bind:this={root}>
  {#if !narrow || !showing}
    <nav class="split-list" aria-label={label} bind:this={list}>
      <ul>
        {@render top?.()}
        {#each items as item (keyOf(item))}
          <li>
            <button
              type="button"
              class="split-row"
              data-key={keyOf(item)}
              aria-current={(selected && keyOf(selected) === keyOf(item)) || undefined}
              data-off={off?.(item) || undefined}
              onclick={() => void pick(item)}
            >
              {@render row(item)}
            </button>
          </li>
        {/each}
      </ul>
    </nav>
  {/if}
  {#if showing}
    <article class="split-detail">
      {#if narrow}<BackButton {label} onclick={() => void back()} />{/if}
      {@render detail()}
    </article>
  {/if}
</div>

<style>
  .split {
    display: grid;
    grid-template-columns: 17rem minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }
  .split[data-narrow] {
    grid-template-columns: minmax(0, 1fr);
  }
  .split-list {
    padding: 0.375rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .split-list :global(.split-row) {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.125rem;
    width: 100%;
    padding: 0.5rem 0.625rem;
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .split-list :global(.split-row:hover) {
    background: var(--muted);
  }
  .split-list :global(.split-row[aria-current]) {
    background: color-mix(in srgb, var(--accent-fill) 10%, transparent);
  }
  [data-narrow] .split-list :global(.split-row) {
    padding: 0.75rem 0.625rem;
  }
  .split-list :global(.split-name) {
    font-size: var(--text-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .split-list :global(.split-desc) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .split-list :global(.split-row[data-off] .split-name) {
    color: var(--muted-foreground);
  }
  .split-detail {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }
</style>
