<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    label,
    description,
    children,
  }: { label: string; description: string; children: Snippet } = $props();
</script>

<div class="p-4 flex items-center justify-between form-row">
  <div>
    <span class="text-xs font-medium text-gray-900 block">{label}</span><span
      class="text-[11px] text-gray-400 block mt-0.5">{description}</span
    >
  </div>
  {@render children()}
</div>
