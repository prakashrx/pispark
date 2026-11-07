<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  let {
    children,
  }: { children: Snippet } = $props();

  let expanded = $state(false);
</script>

<div class="border border-zinc-200/60 rounded-lg overflow-hidden text-xs">
  <button
    type="button"
    class="w-full flex items-center justify-between px-3 py-1.5 bg-zinc-50/80 hover:bg-zinc-100 transition-colors font-sans text-[11px] text-zinc-500"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span class="flex items-center gap-1.5 text-zinc-600 font-medium">
      <Icon name="thought" class="w-3.5 h-3.5 text-zinc-400" />
      Thinking
    </span>
    <span class="text-zinc-400">{expanded ? "▴" : "▾"}</span>
  </button>
  {#if expanded}
    <div class="px-3 py-2 border-t border-zinc-200/60 text-[11px] text-zinc-500 leading-relaxed font-sans">
      {@render children()}
    </div>
  {/if}
</div>
