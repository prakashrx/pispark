<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  let {
    children,
    type = "button",
    unavailable,
    variant = "secondary",
    size = "normal",
    loading = false,
    class: className = "",
    onclick,
    ...attributes
  }: HTMLButtonAttributes & {
    children?: Snippet;
    unavailable?: string;
    variant?: "primary" | "secondary" | "ghost" | "destructive";
    size?: "compact" | "normal" | "icon";
    loading?: boolean;
  } = $props();
</script>

<button
  {...attributes}
  {type}
  class={`ui-button ${className}`}
  data-variant={variant}
  data-size={size}
  disabled={attributes.disabled || loading}
  aria-busy={loading || attributes["aria-busy"]}
  aria-disabled={unavailable ? true : attributes["aria-disabled"]}
  title={unavailable ?? attributes.title}
  onclick={(event) => {
    if (unavailable || loading) {
      event.preventDefault();
      return;
    }
    onclick?.(event);
  }}
>
  {#if loading}<span class="sr-only">Working. </span>{/if}
  {@render children?.()}
</button>

<style>
  :global(.ui-button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.8rem;
    background: var(--background);
    color: var(--foreground);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 500;
    line-height: 1.25rem;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  :global(.ui-button:where(:hover:not(:disabled):not([aria-disabled="true"]))) {
    background: var(--muted);
  }
  :global(.ui-button:where([data-variant="primary"])) {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-foreground);
  }
  :global(.ui-button:where([data-variant="primary"]:hover:not(:disabled))) {
    opacity: 0.88;
  }
  :global(.ui-button:where([data-variant="ghost"])) {
    background: transparent;
    border-color: transparent;
  }
  :global(.ui-button:where([data-variant="ghost"]:hover:not(:disabled):not([aria-disabled="true"]))) {
    background: var(--accent);
    border-color: transparent;
  }
  :global(.ui-button:where([data-variant="destructive"])) {
    color: var(--danger-foreground);
    border-color: color-mix(in srgb, var(--destructive) 25%, transparent);
  }
  :global(.ui-button:where([data-size="compact"])) {
    padding: 0.2rem 0.5rem;
  }
  :global(.ui-button:where([data-size="icon"])) {
    width: 2rem;
    height: 2rem;
    padding: 0.25rem;
    border: none;
    background: transparent;
  }
  :global(.ui-button:where([data-size="icon"]:hover:not(:disabled):not([aria-disabled="true"]))) {
    background: var(--accent);
  }
  :global(.ui-button:where(:disabled)),
  :global(.ui-button:where([aria-disabled="true"])) {
    opacity: 0.4;
    cursor: not-allowed;
  }
  :global(.ui-button:where(:focus-visible)) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
