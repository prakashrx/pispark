<script lang="ts">
  /**
   * A foldable section with a heading (design language §1.5a): sections sit in a stack separated by
   * a rule, not boxed. The heading folds it; an action (such as Add) may sit at its end.
   */
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    title,
    count,
    open = $bindable(true),
    action,
    children,
  }: {
    title: string;
    /** A short figure after the title: "2", "1 running". */
    count?: string;
    open?: boolean;
    action?: Snippet;
    children: Snippet;
  } = $props();
  const id = $props.id();
</script>

<section class="fold" aria-labelledby="{id}-title">
  <div class="head">
    <h3 class="heading">
      <button type="button" class="toggle" aria-expanded={open} aria-controls="{id}-body" onclick={() => (open = !open)}>
        <Icon name={open ? "chevronDown" : "chevronRight"} class="h-3.5 w-3.5 shrink-0" />
        <span id="{id}-title" class="title">{title}</span>
        {#if count}<span class="count">{count}</span>{/if}
      </button>
    </h3>
    {#if action}{@render action()}{/if}
  </div>
  {#if open}<div id="{id}-body" class="body">{@render children()}</div>{/if}
</section>

<style>
  .fold {
    padding: 0.125rem 0 0.375rem;
    border-bottom: 1px solid var(--border);
  }
  .fold:last-child {
    border-bottom: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .heading {
    flex: 1;
    min-width: 0;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    width: 100%;
    min-height: 2.25rem;
    margin-left: -0.25rem;
    padding: 0 0.25rem;
    border-radius: var(--radius-sm);
    text-align: left;
    color: var(--muted-foreground);
  }
  .toggle:hover {
    color: var(--foreground);
  }
  .title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--foreground);
  }
  .count {
    font-size: var(--text-xs);
  }
  .body {
    padding-left: 1.25rem;
  }
  :global([data-size="compact"]) .toggle {
    min-height: 2.75rem;
  }
</style>
