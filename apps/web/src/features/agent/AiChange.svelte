<script lang="ts">
  /**
   * Over a document Agent Builder changed: what it did, how much, and Keep or Undo. The changed
   * parts are marked in the document itself (the editor's `compare`). Shows nothing otherwise.
   */
  import { keyOf, type AgentPage, type Row } from "./agent-page.svelte";
  import { sourceBlocks, changedBlocks } from "../../lib/markdown/blocks";

  let { page, item }: { page: AgentPage; item: Row } = $props();
  const before = $derived(page.before[keyOf(item)]);
  const parts = $derived.by(() => {
    if (before === undefined) return 0;
    const now = sourceBlocks(page.draft(item));
    return changedBlocks(now, before).size;
  });
</script>

{#if before !== undefined}
  <div class="change" role="status">
    <p>{before === "" ? "Agent Builder wrote this." : `Agent Builder changed ${parts === 1 ? "the highlighted part" : "the highlighted parts"}.`}</p>
    <div class="acts">
      <button type="button" class="ui-button" data-variant="ghost" data-size="compact" disabled={page.client.busy} onclick={() => void page.undo(item)}>{before === "" ? "Delete it" : "Undo"}</button>
      <button type="button" class="ui-button" data-variant="secondary" data-size="compact" onclick={() => page.keep(item)}>Keep</button>
    </div>
  </div>
{/if}

<style>
  .change {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.5rem 0.5rem 0.5rem 0.875rem;
    border: 1px solid color-mix(in srgb, var(--accent-fill) 28%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent-fill) 9%, transparent);
  }
  p {
    flex: 1 1 12rem;
    font-size: var(--text-sm);
  }
  .acts {
    display: flex;
    gap: 0.375rem;
  }
</style>
