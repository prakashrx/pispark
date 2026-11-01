<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  let {
    value = $bindable(""),
    label,
    ...attributes
  }: Omit<HTMLInputAttributes, "value"> & {
    value?: string;
    label: string;
  } = $props();
</script>

<input {...attributes} aria-label={label} bind:value />
