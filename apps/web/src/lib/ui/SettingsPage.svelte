<script lang="ts">
  import { getContext, type Snippet } from "svelte";
  /** A settings-like page's content: its heading, what it is for, its actions, then its sections. */
  let {
    title,
    description,
    actions,
    children,
    width = "normal",
    level = 2,
  }: {
    title: string;
    description?: string;
    actions?: Snippet;
    children: Snippet;
    width?: "normal" | "wide";
    /** 1 when the screen's top bar shows no title of its own. */
    level?: 1 | 2;
  } = $props();
  const id = $props.id();
  // Where the screen's top bar already names the page, the page doesn't name it again.
  const bar = getContext<{ named: boolean } | undefined>("settings-page:named-by-bar");
  const named = $derived(bar?.named ?? false);
</script>

<section aria-labelledby={named ? undefined : id} aria-label={named ? title : undefined} class="settings-page">
  <div class="settings-column" data-width={width}>
    <header class="settings-header" data-purpose="settings-header">
      <div class="min-w-0">
        {#if !named}<svelte:element this={`h${level}`} {id} class="settings-title">{title}</svelte:element>{/if}
        {#if description}<p>{description}</p>{/if}
      </div>
      {#if actions}<div class="settings-actions">{@render actions()}</div>{/if}
    </header>
    {@render children()}
  </div>
</section>

<style>
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
  .settings-title {
    font-size: var(--text-2xl);
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
</style>
