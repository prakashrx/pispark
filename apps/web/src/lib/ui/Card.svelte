<script lang="ts">
  /**
   * A titled card of rows (design set 6): the title, an optional count, and an action at its end
   * (a switch, +); then its rows, each divided by a rule. Cards sit in a grid that gives each its
   * own column where there is room (`wide` spans every column).
   */
  import type { Snippet } from "svelte";
  let {
    title,
    count,
    note,
    action,
    wide = false,
    children,
  }: {
    title: string;
    /** A short figure after the title: "2". */
    count?: string;
    /** A quiet word after the title: "Default". */
    note?: string;
    action?: Snippet;
    wide?: boolean;
    children: Snippet;
  } = $props();
  const id = $props.id();
</script>

<section class="card" class:wide aria-labelledby={id}>
  <header class="head">
    <h2 {id} class="title">{title}</h2>
    {#if count}<span class="quiet">{count}</span>{/if}
    {#if note}<span class="quiet">{note}</span>{/if}
    <span class="grow"></span>
    {#if action}{@render action()}{/if}
  </header>
  <div class="body">{@render children()}</div>
</section>

<style>
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-card, var(--radius-md));
    background: var(--card);
    min-width: 0;
  }
  /* Not clipped, so a picker inside can open past the card's edge; its rows keep the corners. */
  .card > :global(:first-child) {
    border-radius: var(--radius-card, var(--radius-md)) var(--radius-card, var(--radius-md)) 0 0;
  }
  .body > :global(:last-child) {
    border-radius: 0 0 var(--radius-card, var(--radius-md)) var(--radius-card, var(--radius-md));
  }
  .card.wide {
    grid-column: 1 / -1;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 3rem;
    padding: 0.375rem 0.75rem 0.375rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .quiet {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .grow {
    flex: 1;
  }
  .body > :global(* + *) {
    border-top: 1px solid var(--border);
  }
</style>
