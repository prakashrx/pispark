<script lang="ts">
  import type { Snippet } from "svelte";
  /** `label`: an extension's name for collapsed thinking (Pi's setHiddenThinkingLabel). */
  let { children, label = "Thinking" }: { children: Snippet; label?: string } = $props();
  let expanded = $state(false);
</script>

<div class="thought">
  <button type="button" class="thought-toggle" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
    <svg class="thought-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3Z" />
    </svg>
    <span>{label}</span>
    <svg class="thought-chevron" class:open={expanded} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
    </svg>
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
    align-items: flex-start;
    gap: 0.5rem;
  }
  .thought-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem 0.3rem 0.55rem;
    border: none;
    border-radius: var(--radius-full);
    background: var(--muted);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--muted-foreground);
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
  }
  .thought-toggle:hover {
    color: var(--foreground);
    background: var(--sidebar-accent);
  }
  .thought-icon {
    width: 0.95rem;
    height: 0.95rem;
    color: var(--interactive-text);
  }
  .thought-chevron {
    width: 0.85rem;
    height: 0.85rem;
    opacity: 0.7;
    transition: transform 0.15s;
  }
  .thought-chevron.open {
    transform: rotate(180deg);
  }
  .thought-body {
    align-self: stretch;
    padding: 0.25rem 0 0.25rem 1rem;
    border-left: 2px solid color-mix(in srgb, var(--interactive) 35%, var(--border));
    font-size: 0.9375rem;
    color: var(--muted-foreground);
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
