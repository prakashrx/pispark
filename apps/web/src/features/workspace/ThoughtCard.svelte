<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  let {
    duration,
    tokens,
    children,
  }: { duration: string; tokens?: number; children: Snippet } = $props();
</script>

<div
  class="border border-zinc-200/70 rounded-lg p-2.5 bg-zinc-50/60 text-xs font-mono text-zinc-600 space-y-1.5"
>
  <div
    class="flex items-center justify-between text-zinc-500 font-sans font-medium text-[11px]"
  >
    <span class="flex items-center gap-1.5 text-zinc-700"
      ><Icon name="thought" class="w-3.5 h-3.5 text-zinc-400" />Thought Process
      ({duration})</span
    >{#if tokens}<span class="text-[10px] text-zinc-400"
        >{tokens} tokens generated</span
      >{/if}
  </div>
  <p class="text-zinc-600 font-sans leading-relaxed text-[11px]">
    {@render children()}
  </p>
</div>
