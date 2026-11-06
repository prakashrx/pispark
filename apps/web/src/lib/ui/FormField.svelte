<script lang="ts">
  import type { Snippet } from "svelte";
  const generatedId = $props.id();
  let {
    label,
    help,
    error,
    required = false,
    id = generatedId,
    children,
  }: {
    label: string;
    help?: string;
    error?: string;
    required?: boolean;
    id?: string;
    children: Snippet<[string, string | undefined]>;
  } = $props();
  const describedby = $derived(
    [help ? `${id}-help` : undefined, error ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined,
  );
</script>

<div class="space-y-1.5 min-w-0">
  <label for={id} class="block text-xs font-medium text-neutral-900"
    >{label}{#if required}<span aria-hidden="true"> *</span>{/if}</label
  >
  {@render children(id, describedby)}
  {#if help}<p id={`${id}-help`} class="text-xs text-neutral-500">
      {help}
    </p>{/if}
  {#if error}<p id={`${id}-error`} role="alert" class="text-xs text-red-700">
      {error}
    </p>{/if}
</div>
