<script lang="ts">
  let {
    name,
    result,
    content = "",
  }: { name: string; result: "running" | "done" | "error"; content?: string } = $props();

  let expanded = $state(false);
  const hasContent = $derived(!!content?.trim());

  const statusLabel = $derived(
    result === "running" ? "Running" : result === "error" ? "Failed" : "Done"
  );
  const statusClass = $derived(
    result === "running"
      ? "text-amber-600"
      : result === "error"
        ? "text-red-500"
        : "text-emerald-600"
  );
  const dotClass = $derived(
    result === "running"
      ? "bg-amber-400 animate-pulse"
      : result === "error"
        ? "bg-red-400"
        : "bg-emerald-500"
  );
</script>

<div class="border border-zinc-200/80 rounded-lg overflow-hidden text-xs bg-white">
  <button
    type="button"
    class="w-full flex items-center justify-between px-3 py-1.5 bg-zinc-50 font-mono text-[11px] hover:bg-zinc-100 transition-colors"
    onclick={() => { if (hasContent) expanded = !expanded; }}
    aria-expanded={hasContent ? expanded : undefined}
  >
    <div class="flex items-center gap-2">
      <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-zinc-200/60 font-semibold text-zinc-700">TOOL</span>
      <span class="text-zinc-800 font-medium">{name}</span>
    </div>
    <div class="flex items-center gap-1.5">
      <span class={`inline-flex items-center gap-1 font-medium ${statusClass}`}>
        <span class={`w-1.5 h-1.5 rounded-full ${dotClass}`}></span>
        {statusLabel}
      </span>
      {#if hasContent}
        <span class="text-zinc-400 ml-1">{expanded ? "▴" : "▾"}</span>
      {/if}
    </div>
  </button>
  {#if expanded && hasContent}
    <div class="px-3 py-2 border-t border-zinc-200/70 font-mono text-[11px] text-zinc-600 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-relaxed bg-white">
      {content}
    </div>
  {/if}
</div>
