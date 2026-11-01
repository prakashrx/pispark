<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Symbol from "../../lib/ui/Symbol.svelte";
  import type { Source } from "./fixtures";
  let {
    source,
    onremove,
    ontoggle,
  }: { source: Source; onremove: () => void; ontoggle: () => void } = $props();
</script>

<div
  class="group bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-all duration-200"
>
  <div class="source-row flex items-start justify-between gap-4">
    <div class="space-y-1.5 min-w-0 flex-1">
      <div class="flex items-center flex-wrap gap-2">
        <h2
          class="text-sm font-semibold text-gray-900 font-mono tracking-tight"
        >
          {source.name}
        </h2>
        <span
          class={source.status === "Active"
            ? "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700"
            : "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600"}
          title="Local fixture state; not a connection status"
          ><span
            class={source.status === "Active"
              ? "w-1.5 h-1.5 rounded-full bg-emerald-500"
              : "w-1.5 h-1.5 rounded-full bg-gray-400"}
          ></span>{source.status}</span
        >
        <span
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-500 bg-gray-100"
          ><Symbol
            name={source.kind === "Local Git"
              ? "emoji_symbols"
              : source.kind === "Marketplace"
                ? "storefront"
                : "terminal"}
            class="text-[12px] text-gray-400"
          />{source.kind}</span
        >
        {#if source.official}<span
            class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700"
            ><Symbol name="verified" class="text-[12px]" />Official</span
          >{/if}
        {#if source.branch}<span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-500 bg-gray-50"
            >branch: <span class="text-gray-700 font-semibold"
              >{source.branch}</span
            ></span
          >{/if}
      </div>
      <div
        class="flex items-center gap-2 text-xs text-gray-500 font-mono truncate"
      >
        <span class="text-gray-600 truncate">{source.location}</span><span
          class="text-gray-300">·</span
        ><span class="text-gray-400"
          >{#if source.kind === "Local Git"}rev <span class="text-gray-600"
              >{source.detail.replace("rev ", "")}</span
            >{:else}{source.detail}{/if}</span
        >
      </div>
      <div
        class="flex items-center flex-wrap gap-2 pt-1 text-[11px] text-gray-500"
      >
        {#each source.resources as resource}<span
            class="bg-gray-50 text-gray-600 px-2 py-0.5 rounded"
            >{resource}</span
          >{/each}<span class="text-gray-400 font-mono text-[10px] ml-1"
          >{source.updated}</span
        >
      </div>
    </div>
    <div class="source-actions flex items-center gap-1 pt-0.5 shrink-0">
      <Button
        class="source-action"
        unavailable="Resource inspector is not included in the supplied design"
        >Inspect resources</Button
      >
      <Button
        class="source-action flex items-center gap-1"
        unavailable="Source synchronization requires the backend"
        ><Symbol name="sync" class="text-[14px] text-gray-400" /><span
          >{source.kind === "Marketplace" ? "Sync" : "Check updates"}</span
        ></Button
      >
      {#if source.kind === "Marketplace"}<Button
          class="px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 bg-gray-50 hover:bg-gray-100 rounded-md transition"
          title="Toggle marketplace in local draft"
          onclick={ontoggle}
          >{source.status === "Disabled" ? "Enable" : "Disable"}</Button
        >
      {:else}<Button
          class="p-1 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-50 transition"
          aria-label={`Edit ${source.name}`}
          unavailable="Source editing form is not included in the supplied design"
          ><Symbol name="tune" class="text-[16px]" /></Button
        >{/if}
      <Button
        class="p-1 text-gray-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition"
        aria-label={`Remove ${source.name}`}
        title="Remove source from local draft"
        onclick={onremove}><Symbol name="delete" class="text-[16px]" /></Button
      >
    </div>
  </div>
</div>
