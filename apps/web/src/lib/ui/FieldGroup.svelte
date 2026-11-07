<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    title,
    help,
    actions,
    children,
    disabled = false,
  }: {
    title: string;
    help?: string;
    actions?: Snippet;
    children: Snippet;
    disabled?: boolean;
  } = $props();
</script>

<fieldset
  {disabled}
  class="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3"
>
  <legend class="px-1 text-sm font-medium text-foreground">{title}</legend>
  {#if help}<p class="text-sm text-muted-foreground">{help}</p>{/if}
  {#if actions}<div class="flex justify-end gap-2">
      {@render actions()}
    </div>{/if}
  {@render children()}
</fieldset>
