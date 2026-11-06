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
  class="min-w-0 rounded-lg border border-neutral-200 p-4 space-y-3"
>
  <legend class="px-1 text-xs font-medium text-neutral-900">{title}</legend>
  {#if help}<p class="text-xs text-neutral-500">{help}</p>{/if}
  {#if actions}<div class="flex justify-end gap-2">
      {@render actions()}
    </div>{/if}
  {@render children()}
</fieldset>
