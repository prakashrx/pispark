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

<details bind:open class="rounded-xl border border-[var(--border)] px-4 py-3 text-sm">
  <summary class="cursor-pointer font-medium text-foreground">{title}</summary>
  <div class="mt-3 space-y-3">
    {#if help}<p class="text-muted-foreground">{help}</p>{/if}{@render children()}
  </div>
</details>
