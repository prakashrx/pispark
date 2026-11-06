<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    title,
    help,
    open = $bindable(false),
    children,
  }: {
    title: string;
    help?: string;
    open?: boolean;
    children: Snippet;
  } = $props();
</script>

<details bind:open class="rounded-lg border border-neutral-200 p-3 text-xs">
  <summary class="cursor-pointer font-medium text-neutral-700">{title}</summary>
  <div class="mt-3 space-y-3">
    {#if help}<p class="text-neutral-500">{help}</p>{/if}{@render children()}
  </div>
</details>
