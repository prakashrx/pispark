<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    title,
    description,
    children,
    variant = "settings",
    layout = "stacked",
    class: className = "",
  }: {
    title: string;
    description: string;
    children: Snippet;
    variant?: "persona" | "settings";
    layout?: "stacked" | "split";
    class?: string;
  } = $props();
</script>

<section class={className} data-layout={layout}>
  <div>
    <h2 class="text-xs font-semibold uppercase tracking-wider text-zinc-500">
      {title}
    </h2>
    <p class="text-[11px] text-zinc-400">
      {description}
    </p>
  </div>
  {#if layout === "split"}
    <div class="section-content">{@render children()}</div>
  {:else}
    {@render children()}
  {/if}
</section>

<style>
  section[data-layout="split"] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 4fr);
    gap: 1.5rem;
    align-items: start;
  }
  .section-content {
    min-width: 0;
  }
  @media (max-width: 640px) {
    section[data-layout="split"] {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.75rem;
    }
  }
</style>
