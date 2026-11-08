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
  class="flex items-start gap-2 text-sm text-neutral-700 has-[:disabled]:opacity-50"
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
    class="ui-checkbox"
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
        class:text-[var(--danger-foreground)]={!!error}
        role={error ? "alert" : undefined}>{error || help}</span
      >{/if}</span
  >
</label>

<style>
  /* Native control tinted with the accent, like Radio: the browser keeps the
     check readable on every theme's accent, light or dark. */
  .ui-checkbox {
    appearance: auto;
    margin: 0.125rem 0 0;
    flex-shrink: 0;
    width: 0.875rem;
    height: 0.875rem;
    accent-color: var(--interactive);
  }
  .ui-checkbox:focus {
    box-shadow: none;
  }
  .ui-checkbox:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
