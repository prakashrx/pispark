<script lang="ts">
  import type { Snippet } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { copyText } from "../../lib/clipboard";
  let {
    path,
    diff = false,
    copy = "",
    children,
  }: {
    path: string;
    diff?: boolean;
    copy?: string;
    children: Snippet;
  } = $props();
  let notice = $state("");
</script>

<div
  class="relative border border-zinc-200/90 rounded-xl overflow-hidden bg-white shadow-elevation-sm"
>
  <div
    class="flex items-center justify-between px-4 py-2 bg-zinc-50/80 border-b border-zinc-200/80 text-xs font-mono"
  >
    <div class="flex items-center gap-2 text-zinc-700">
      <Icon
        name={diff ? "file" : "code"}
        class="w-3.5 h-3.5 text-zinc-400"
      /><span class="font-semibold">{path}</span>{#if diff}<span
          class="text-[11px] text-zinc-400 font-normal ml-2"
          ><span class="text-emerald-600 font-medium">+2</span> /
          <span class="text-rose-500 font-medium">-1</span></span
        >{/if}
    </div>
    {#if diff}<div class="flex items-center gap-2">
        <Button
          onclick={async () => {
            notice = await copyText(copy);
          }}
          class="px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 border border-zinc-200 rounded hover:bg-zinc-50 transition-colors"
          title={notice || undefined}
          >{notice ? (notice.startsWith('Copied') ? 'Copied' : 'Copy failed') : 'Copy'}</Button
        ><Button
          unavailable="Applying file changes requires the backend"
          class="px-2 py-0.5 text-[11px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded transition-colors"
          >Apply</Button
        >
      </div>{:else}<span class="text-[11px] text-zinc-400">TypeScript</span
      >{/if}
  </div>
  <div
    class={diff
      ? "p-4 font-mono text-xs overflow-x-auto bg-[#fafafa]/50 leading-loose"
      : "p-4 font-mono text-xs overflow-x-auto bg-[#fafafa]/50 leading-relaxed text-zinc-800"}
  >
    {@render children()}
  </div>
  <p class="sr-only" role="status">{notice}</p>
</div>
