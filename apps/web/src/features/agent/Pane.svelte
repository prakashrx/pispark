<script lang="ts">
  /**
   * A named part of an open resource: SKILL.md, Use when, Template, Preview, an extension's tools.
   * A small heading, an optional action beside it, then the content. One heading style for every
   * part on every tab.
   */
  import type { Snippet } from "svelte";

  let {
    title,
    count,
    area,
    action,
    children,
  }: {
    title: string;
    /** Quiet text after the title, e.g. "3 of 4 on". */
    count?: string;
    /** The grid area, where the parent lays parts out in a grid. */
    area?: string;
    action?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="pane" style:grid-area={area}>
  <div class="pane-head">
    <h3>
      {title}{#if count}<span class="count">{count}</span>{/if}
    </h3>
    {@render action?.()}
  </div>
  {@render children()}
</section>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  .pane-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 2rem;
  }
  h3 {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted-foreground);
  }
  .count {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
</style>
