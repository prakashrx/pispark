<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  let {
    children,
    type = "button",
    unavailable,
    onclick,
    ...attributes
  }: HTMLButtonAttributes & {
    children?: Snippet;
    unavailable?: string;
  } = $props();
</script>

<button
  {...attributes}
  {type}
  aria-disabled={unavailable ? true : attributes["aria-disabled"]}
  title={unavailable ?? attributes.title}
  onclick={(event) => {
    if (unavailable) {
      event.preventDefault();
      return;
    }
    onclick?.(event);
  }}
>
  {@render children?.()}
</button>
