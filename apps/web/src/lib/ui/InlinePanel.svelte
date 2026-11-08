<script lang="ts">
  /**
   * An in-page editing panel: the page stays visible and scrollable while a
   * focused task is open. Owns initial focus, Escape dismissal and focus return.
   * variant="editor" is for editing an item in place (inside its own row): no title
   * bar or close button, just the fields and actions. Escape and Cancel still close it.
   */
  import { onMount, type Snippet } from "svelte";
  import Button from "./Button.svelte";
  let {
    label,
    onclose,
    children,
    title,
    help,
    footer,
    size = "normal",
    initialFocus,
    busy = false,
    variant = "panel",
  }: {
    label: string;
    onclose: () => void;
    children: Snippet;
    title?: string;
    help?: string;
    footer?: Snippet;
    size?: "small" | "normal" | "wide";
    initialFocus?: string;
    busy?: boolean;
    variant?: "panel" | "editor";
  } = $props();
  let panel: HTMLElement;
  const id = $props.id();
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target = initialFocus
      ? panel.querySelector<HTMLElement>(initialFocus)
      : panel.querySelector<HTMLElement>(
          "input:not(:disabled):not([type=file]), textarea:not(:disabled), select:not(:disabled)",
        );
    (
      target ??
      panel.querySelector<HTMLElement>("button:not(:disabled)") ??
      panel
    ).focus({ preventScroll: true });
    panel.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    return () => {
      // Return focus only when it would otherwise be lost with the panel.
      if (
        previous?.isConnected &&
        (!document.activeElement ||
          document.activeElement === document.body ||
          panel.contains(document.activeElement))
      )
        previous.focus();
    };
  });
</script>

<svelte:window
  onkeydown={(event) => {
    // Focus can fall back to the page when the control that held it re-renders.
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    event.preventDefault();
    if (!busy) onclose();
  }}
/>
<!-- Escape is delegated from the controls inside the panel. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  bind:this={panel}
  tabindex="-1"
  class="inline-panel"
  data-size={size}
  data-variant={variant}
  aria-label={title ? undefined : label}
  aria-labelledby={title ? `${id}-title` : undefined}
  aria-describedby={help ? `${id}-help` : undefined}
  aria-busy={busy || undefined}
  onkeydown={(event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // Let open popups (selectors, menus) close themselves first.
    if ((event.target as HTMLElement).closest('[aria-expanded="true"], [role="listbox"], [role="menu"]'))
      return;
    event.preventDefault();
    event.stopPropagation();
    if (!busy) onclose();
  }}
>
  {#if title && variant === "editor"}<h3 id={`${id}-title`} class="sr-only">{title}</h3>
    {#if help}<p id={`${id}-help`} class="inline-panel-help">{help}</p>{/if}
  {:else if title}<header class="inline-panel-header">
      <div class="min-w-0">
        <h3 id={`${id}-title`} class="text-[0.9375rem] font-semibold">{title}</h3>
        {#if help}<p id={`${id}-help`} class="mt-0.5 text-[0.8125rem] text-muted-foreground">
            {help}
          </p>{/if}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Close ${title}`}
        disabled={busy}
        onclick={onclose}>×</Button
      >
    </header>{/if}
  <div class="inline-panel-body">{@render children()}</div>
  {#if footer}<footer class="inline-panel-footer">{@render footer()}</footer>{/if}
</section>

<style>
  .inline-panel {
    position: relative;
    margin-top: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--interactive) 40%, var(--border));
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--interactive) 10%, transparent),
      var(--shadow-sm);
    scroll-margin: 1.5rem;
  }
  .inline-panel:focus {
    outline: none;
  }
  .inline-panel[data-size="small"] {
    max-width: 32rem;
  }
  .inline-panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.875rem 1rem 0.75rem 1.125rem;
    border-bottom: 1px solid var(--border);
  }
  .inline-panel-body {
    padding: 1rem 1.125rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .inline-panel[data-variant="editor"] {
    margin-top: 0.5rem;
    border-color: var(--border);
    background: var(--card);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }
  .inline-panel[data-variant="editor"]:focus-within {
    border-color: color-mix(in srgb, var(--interactive) 45%, var(--border));
  }
  .inline-panel[data-variant="editor"] .inline-panel-body {
    padding: 0.875rem 1rem 0.25rem;
    gap: 0.875rem;
  }
  .inline-panel[data-variant="editor"] .inline-panel-footer {
    border-top: 0;
    padding: 0.75rem 1rem 0.875rem;
  }
  .inline-panel-help {
    padding: 0.875rem 1rem 0;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .inline-panel-footer {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
  }
</style>
