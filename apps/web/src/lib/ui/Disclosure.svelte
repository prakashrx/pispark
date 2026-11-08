<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    title,
    help,
    open = $bindable(false),
    children,
    variant = "boxed",
  }: {
    title: string;
    help?: string;
    open?: boolean;
    children: Snippet;
    /** "plain" is a text toggle for secondary detail inside rows, without its own box. */
    variant?: "boxed" | "plain";
  } = $props();
</script>

<details
  bind:open
  class={variant === "plain"
    ? "text-sm"
    : "rounded-xl border border-[var(--border)] px-4 py-3 text-sm"}
>
  <summary
    class={variant === "plain"
      ? "cursor-pointer text-[0.8125rem] font-medium text-[var(--interactive-text)]"
      : "cursor-pointer font-medium text-foreground"}>{title}</summary
  >
  <div class={variant === "plain" ? "mt-2 space-y-2" : "mt-3 space-y-3"}>
    {#if help}<p class="text-muted-foreground">{help}</p>{/if}{@render children()}
  </div>
</details>
