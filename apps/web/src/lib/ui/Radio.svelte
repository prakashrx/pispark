<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import type { Snippet } from "svelte";
  const generatedId = $props.id();
  let {
    label,
    help,
    children,
    id = generatedId,
    ...attributes
  }: HTMLInputAttributes & {
    label: string;
    help?: string;
    children?: Snippet;
  } = $props();
</script>

<label
  for={id}
  class="ui-radio flex items-start gap-3 p-3 text-sm cursor-pointer"
>
  <input
    {...attributes}
    {id}
    type="radio"
    aria-labelledby={attributes["aria-label"] ? undefined : `${id}-label`}
    aria-describedby={help ? `${id}-help` : attributes["aria-describedby"]}
  />
  <span class="min-w-0"
    ><span id={`${id}-label`} class="block font-medium break-words"
      >{label}</span
    >{#if help}<span id={`${id}-help`} class="block mt-1 text-neutral-500"
        >{help}</span
      >{/if}{#if children}{@render children()}{/if}</span
  >
</label>

<style>
  .ui-radio:has(input:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  /* Native control tinted with the accent: the browser keeps the dot readable
     on every theme's accent, light or dark. */
  .ui-radio input[type="radio"] {
    appearance: auto;
    margin: 0.125rem 0 0;
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
    accent-color: var(--interactive);
  }
  .ui-radio input:focus {
    box-shadow: none;
  }
  .ui-radio input:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
