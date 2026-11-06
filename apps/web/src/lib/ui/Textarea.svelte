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
    border: 1px solid #d4d4d4;
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: white;
    color: #171717;
    font-size: 0.75rem;
    line-height: 1.5;
  }
  :global(.ui-input:where([data-density="compact"])) {
    padding: 0.25rem 0.5rem;
  }
  :global(.ui-input:focus),
  :global([type].ui-input:focus) {
    box-shadow: none;
    border-color: #737373;
    outline: 2px solid #737373;
    outline-offset: 2px;
  }
  :global(.ui-input[aria-invalid="true"]),
  :global([type].ui-input[aria-invalid="true"]:focus) {
    border-color: #b91c1c;
  }
  :global(.ui-input:where(:disabled)) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :global(.ui-input:where(:read-only)) {
    background: #fafafa;
  }
</style>
