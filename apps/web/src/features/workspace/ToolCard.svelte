<script lang="ts">
  let {
    name,
    target,
    result,
  }: { name: string; target: string; result: string } = $props();
</script>

<div
  class="border border-zinc-200/80 rounded-lg bg-white overflow-hidden text-xs"
>
  <div
    class="flex items-center justify-between px-3 py-1.5 bg-zinc-50 border-b border-zinc-200/70 font-mono text-[11px]"
  >
    <div class="flex items-center gap-2">
      <span
        class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-zinc-200/60 font-semibold text-zinc-700"
        >TOOL</span
      ><span class="text-zinc-800 font-medium">{name}</span><span
        class="text-zinc-400">{target}</span
      >
    </div>
    <span class="inline-flex items-center gap-1 text-emerald-600 font-medium"
      ><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"
      ></span>{result}</span
    >
  </div>
</div>
