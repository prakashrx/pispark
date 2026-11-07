<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    label,
    description,
    children,
  }: { label: string; description: string; children: Snippet } = $props();
</script>

<div class="px-5 py-4 flex items-center justify-between gap-6 form-row">
  <div class="min-w-0">
    <span class="text-sm font-medium text-foreground block">{label}</span
    >{#if description}<span
        class="text-[0.8125rem] text-muted-foreground block mt-0.5"
        >{description}</span
      >{/if}
  </div>
  {@render children()}
</div>
