<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  let {
    checked = $bindable(false),
    label,
    help,
    error,
    readonly = false,
    onclick,
    ...attributes
  }: Omit<HTMLInputAttributes, "type" | "checked"> & {
    checked?: boolean;
    label: string;
    help?: string;
    error?: string;
    readonly?: boolean;
  } = $props();
  const id = $props.id();
</script>

<label
  class="flex items-start gap-2 text-xs text-neutral-700 has-[:disabled]:opacity-50"
>
  <input
    {...attributes}
    type="checkbox"
    aria-labelledby={attributes["aria-label"] ? undefined : `${id}-label`}
    aria-readonly={readonly || undefined}
    onclick={(event) => {
      if (readonly) event.preventDefault();
      else onclick?.(event);
    }}
    class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
    aria-invalid={!!error || undefined}
    aria-describedby={help || error
      ? `${id}-help`
      : attributes["aria-describedby"]}
    bind:checked
  />
  <span
    ><span id={`${id}-label`} class="block">{label}</span
    >{#if help || error}<span
        id={`${id}-help`}
        class="mt-1 block text-neutral-500"
        class:text-red-700={!!error}
        role={error ? "alert" : undefined}>{error || help}</span
      >{/if}</span
  >
</label>
