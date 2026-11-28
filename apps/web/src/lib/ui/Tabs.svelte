<script lang="ts">
  import type { Snippet } from "svelte";
  /**
   * Tabs with arrow keys, Home and End. Hidden panels stay mounted, so what was typed in them is
   * kept. A tab may carry a count (how many of something it holds), said after its label.
   */
  let {
    label,
    tabs,
    value = $bindable(""),
    children,
    panelClass = "",
  }: {
    label: string;
    tabs: { id: string; label: string; disabled?: boolean; count?: number }[];
    value?: string;
    children: Snippet<[string]>;
    panelClass?: string;
  } = $props();
  const id = $props.id();
  let root: HTMLDivElement;
  const selected = $derived(value || tabs.find((tab) => !tab.disabled)?.id || "");
  function navigate(event: KeyboardEvent, current: string) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = tabs.filter((tab) => !tab.disabled);
    const index = enabled.findIndex((tab) => tab.id === current);
    const next =
      event.key === "Home"
        ? enabled[0]
        : event.key === "End"
          ? enabled.at(-1)
          : enabled[(index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
    if (next) {
      value = next.id;
      root.querySelector<HTMLButtonElement>(`[data-tab-index="${tabs.indexOf(next)}"]`)?.focus();
    }
  }
</script>

<div bind:this={root}>
  <div role="tablist" aria-label={label} class="tabs">
    {#each tabs as tab, index (tab.id)}
      <button
        type="button"
        role="tab"
        id={`${id}-tab-${tab.id}`}
        data-tab-index={index}
        aria-controls={`${id}-panel-${tab.id}`}
        aria-selected={selected === tab.id}
        tabindex={selected === tab.id ? 0 : -1}
        disabled={tab.disabled}
        onclick={() => (value = tab.id)}
        onkeydown={(event) => navigate(event, tab.id)}
        class="tab"
        >{tab.label}{#if tab.count !== undefined}<span class="count">{tab.count}</span>{/if}</button
      >
    {/each}
  </div>
  {#each tabs as tab (tab.id)}
    <div
      role="tabpanel"
      id={`${id}-panel-${tab.id}`}
      aria-labelledby={`${id}-tab-${tab.id}`}
      hidden={selected !== tab.id}
      class={panelClass}
    >
      {@render children(tab.id)}
    </div>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1.25rem;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.5rem;
    padding: 0 0.75rem;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .tab:hover:not(:disabled),
  .tab[aria-selected="true"] {
    color: var(--foreground);
  }
  .tab[aria-selected="true"]::after {
    content: "";
    position: absolute;
    left: 0.5rem;
    right: 0.5rem;
    bottom: -1px;
    height: 2px;
    border-radius: 2px;
    background: var(--foreground);
  }
  .tab:disabled {
    opacity: 0.5;
  }
  .tab:focus-visible {
    outline-offset: -2px;
  }
  .count {
    min-width: 1.25rem;
    padding: 0 0.3125rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    text-align: center;
  }
</style>
