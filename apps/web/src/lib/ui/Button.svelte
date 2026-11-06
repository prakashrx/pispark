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
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: white;
    color: #404040;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.25rem;
  }
  :global(.ui-button:where(:hover:not(:disabled):not([aria-disabled="true"]))) {
    background: #f5f5f5;
  }
  :global(.ui-button:where([data-variant="primary"])) {
    background: #171717;
    border-color: #171717;
    color: white;
  }
  :global(.ui-button:where([data-variant="primary"]:hover:not(:disabled))) {
    background: #404040;
  }
  :global(.ui-button:where([data-variant="ghost"])) {
    background: transparent;
    border-color: transparent;
  }
  :global(.ui-button:where([data-variant="destructive"])) {
    color: #b91c1c;
    border-color: #fecaca;
  }
  :global(.ui-button:where([data-size="compact"])) {
    padding: 0.25rem 0.5rem;
  }
  :global(.ui-button:where([data-size="icon"])) {
    width: 2rem;
    height: 2rem;
    padding: 0.25rem;
  }
  :global(.ui-button:where(:disabled)),
  :global(.ui-button:where([aria-disabled="true"])) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :global(.ui-button:where(:focus-visible)) {
    outline: 2px solid #737373;
    outline-offset: 2px;
  }
</style>
