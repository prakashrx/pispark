<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    title,
    description,
    children,
    variant = "persona",
    class: className = "",
  }: {
    title: string;
    description: string;
    children: Snippet;
    variant?: "persona" | "settings";
    class?: string;
  } = $props();
</script>

<section class={className}>
  <div>
    <h2
      class={variant === "persona"
        ? "text-sm font-bold text-neutral-900"
        : "text-xs font-semibold uppercase tracking-wider text-gray-500"}
    >
      {title}
    </h2>
    <p
      class={variant === "persona"
        ? "text-xs text-neutral-500"
        : "text-[11px] text-gray-400"}
    >
      {description}
    </p>
  </div>
  {@render children()}
</section>
