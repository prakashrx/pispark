<script lang="ts">
  import type { Snippet } from "svelte";
  let { children }: { children: Snippet } = $props();
  let expanded = $state(false);
</script>

<div class="thought">
  <button type="button" class="thought-toggle" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
    <span class="thought-icon">◆</span>
    <span>Thinking</span>
    <span class="thought-chevron">{expanded ? "▴" : "▾"}</span>
  </button>
  {#if expanded}
    <div class="thought-body">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .thought {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .thought-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0;
    background: none;
    border: none;
    font: inherit;
    font-size: 11px;
    color: var(--muted-foreground);
    cursor: pointer;
    transition: color 0.1s;
  }
  .thought-toggle:hover {
    color: var(--foreground);
  }
  .thought-icon {
    font-size: 8px;
    color: var(--warning);
    opacity: 0.8;
  }
  .thought-chevron {
    font-size: 10px;
    opacity: 0.6;
  }
  .thought-body {
    margin-left: 1rem;
    padding: 0.5rem 0.75rem;
    border-left: 2px solid var(--border);
    font-size: 11px;
    color: var(--muted-foreground);
    line-height: 1.65;
    white-space: pre-wrap;
    word-break: break-words;
  }
</style>
