<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";
  let {
    value = $bindable(""),
    label,
    ...attributes
  }: HTMLTextareaAttributes & { label: string } = $props();
</script>

<textarea {...attributes} aria-label={label} bind:value></textarea>
