<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    title,
    description,
    label = title,
    actions,
    children,
    width = "normal",
  }: {
    title: string;
    description?: string;
    label?: string;
    actions?: Snippet;
    children: Snippet;
    width?: "normal" | "wide";
  } = $props();
</script>

<main id="workspace" aria-label={label} class="settings-page">
  <div class="settings-column" data-width={width}>
    <header class="settings-header" data-purpose="settings-header">
      <div class="min-w-0">
        <h1>{title}</h1>
        {#if description}<p>{description}</p>{/if}
      </div>
      {#if actions}<div class="settings-actions">{@render actions()}</div>{/if}
    </header>
    {@render children()}
  </div>
</main>

<style>
  .settings-page {
    flex: 1;
    overflow-y: auto;
    padding: 2.5rem 2rem 5rem;
    background: var(--background);
  }
  .settings-column {
    max-width: 48rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  .settings-column[data-width="wide"] {
    max-width: 60rem;
  }
  .settings-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  h1 {
    font-size: 1.75rem;
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.2;
    color: var(--foreground);
  }
  p {
    margin-top: 0.375rem;
    font-size: 0.9375rem;
    color: var(--muted-foreground);
  }
  .settings-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  @media (max-width: 767px) {
    .settings-page {
      padding: 1.5rem 1rem 4rem;
    }
  }
</style>
