<script lang="ts">
  /**
   * One row of a card: a label, then the value or control. Without a label the content has the
   * whole row (a note, a list item, a sample).
   */
  import type { Snippet } from "svelte";
  let { label, children }: { label?: string; children: Snippet } = $props();
</script>

<div class="row" class:plain={!label}>
  {#if label}<span class="label">{label}</span>{/if}
  <div class="value">{@render children()}</div>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-height: 2.75rem;
    padding: 0.5rem 1rem;
    font-size: var(--text-sm);
  }
  .label {
    width: 7rem;
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .value {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .plain .value {
    display: block;
  }
  @media (max-width: 599.98px) {
    .label {
      width: 6rem;
    }
  }
</style>
