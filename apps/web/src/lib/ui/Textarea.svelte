<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";
  let {
    value = $bindable(""),
    label,
    invalid = false,
    density = "normal",
    monospace = false,
    class: className = "",
    ...attributes
  }: Omit<HTMLTextareaAttributes, "value"> & {
    value?: string;
    label?: string;
    invalid?: boolean;
    density?: "compact" | "normal";
    monospace?: boolean;
  } = $props();
</script>

<textarea
  {...attributes}
  aria-label={label ?? attributes["aria-label"]}
  aria-invalid={invalid || attributes["aria-invalid"]}
  class={`ui-input ${monospace ? "font-mono" : "font-sans"} ${className}`}
  data-density={density}
  data-monospace={monospace}
  bind:value
></textarea>

<style>
  :global(.ui-input),
  :global([type].ui-input) {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    border: 1px solid var(--input);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    background: var(--background);
    color: var(--foreground);
    font-size: 0.875rem;
    line-height: 1.5;
  }
  :global(.ui-input:where([data-density="compact"])) {
    padding: 0.25rem 0.5rem;
  }
  :global(.ui-input:focus),
  :global([type].ui-input:focus) {
    box-shadow: none;
    border-color: var(--interactive);
    outline: 2px solid color-mix(in srgb, var(--interactive) 35%, transparent);
    outline-offset: 1px;
  }
  :global(.ui-input[aria-invalid="true"]),
  :global([type].ui-input[aria-invalid="true"]:focus) {
    border-color: var(--danger);
  }
  :global(.ui-input:where(:disabled)) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :global(.ui-input:where(:read-only)) {
    background: var(--code-surface);
  }
</style>
