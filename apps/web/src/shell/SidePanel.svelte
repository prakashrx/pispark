<script lang="ts">
  /**
   * The side panel (design language §1.5): something to look at or work with beside the screen,
   * never modal. Its own small top bar (Back inside the panel, title, actions, Expand, Close), then
   * content that scrolls on its own. A column where it fits beside the screen; otherwise it lays
   * over the screen from the right. Escape steps back: out of Expand, back to where the panel
   * started, then (laid over) closed.
   */
  import { tick, type Snippet } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import { layout, PANEL_MAX, PANEL_MIN } from "./layout.svelte";

  let {
    title,
    over = false,
    expanded = false,
    wantsFocus = false,
    onfocused,
    onexpand,
    onback,
    backLabel = "Back",
    onclose,
    closeLabel = "Close panel",
    actions,
    children,
  }: {
    title: string;
    /** Lays over the screen instead of sitting beside it. */
    over?: boolean;
    expanded?: boolean;
    /** Move focus to the panel's title (the person opened it); `onfocused` says it was done. */
    wantsFocus?: boolean;
    onfocused?: () => void;
    /** Offer Expand: the panel takes the whole screen until Expand or Escape again. */
    onexpand?: (expanded: boolean) => void;
    onback?: () => void;
    backLabel?: string;
    onclose: () => void;
    closeLabel?: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();

  const id = $props.id();
  let heading = $state<HTMLElement>();
  $effect(() => {
    if (!wantsFocus || !heading) return;
    const target = heading;
    void tick().then(() => {
      target.focus({ preventScroll: true });
      onfocused?.();
    });
  });

  // The column's left edge drags to resize it, or Left/Right with the handle focused.
  function drag(event: PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = layout.panelWidth;
    handle.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => layout.resizePanel(startWidth + startX - next.clientX);
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function resizeKey(event: KeyboardEvent) {
    const step = { ArrowLeft: 16, ArrowRight: -16 }[event.key];
    if (step) layout.resizePanel(layout.panelWidth + step);
    else if (event.key === "Home") layout.resizePanel(PANEL_MIN);
    else if (event.key === "End") layout.resizePanel(PANEL_MAX);
    else return;
    event.preventDefault();
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // Let open popups (pickers, menus) close themselves first.
    if ((event.target as HTMLElement).closest?.('[aria-expanded="true"], [role="listbox"], [role="menu"]')) return;
    if (expanded && onexpand) onexpand(false);
    else if (onback) onback();
    else if (over) onclose();
    else return;
    event.preventDefault();
  }
</script>

<!-- Focus can fall back to the page when the control that held it draws again. -->
<svelte:window
  onkeydown={(event) => {
    if (document.activeElement && document.activeElement !== document.body) return;
    keydown(event);
  }}
/>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  class="side-panel"
  class:over
  class:expanded
  aria-labelledby={id}
  onkeydown={keydown}
  style:width={over || expanded ? undefined : `${layout.panelWidth}px`}
>
  {#if !over && !expanded}<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      aria-valuenow={layout.panelWidth}
      tabindex="0"
      onpointerdown={drag}
      onkeydown={resizeKey}
    ></div>{/if}
  <header class="bar">
    {#if onback}<button type="button" class="tap" aria-label={backLabel} title={backLabel} onclick={onback}>
        <Icon name="back" class="h-4 w-4" />
      </button>{/if}
    <h2 {id} class="title" tabindex="-1" bind:this={heading}>{title}</h2>
    {#if actions}{@render actions()}{/if}
    {#if onexpand}<button
        type="button"
        class="tap"
        aria-label="Expand"
        title="Expand"
        aria-pressed={expanded}
        onclick={() => onexpand(!expanded)}
      >
        <Icon name="expand" class="h-4 w-4" />
      </button>{/if}
    <button type="button" class="tap" aria-label={closeLabel} title={closeLabel} onclick={onclose}>
      <Icon name="close" class="h-4 w-4" />
    </button>
  </header>
  <div class="body">{@render children()}</div>
</aside>

<style>
  .side-panel {
    position: relative;
    width: 380px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--background);
    border-left: 1px solid var(--border);
  }
  .resize {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    z-index: 1;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
  }
  .resize:hover,
  .resize:focus-visible {
    outline: none;
    background: color-mix(in srgb, var(--interactive) 40%, transparent);
  }
  /* Over the screen from the right, not modal: the conversation stays usable beside it. */
  .side-panel.over {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    width: min(420px, 100%);
    box-shadow: var(--shadow-popover);
  }
  /* A portrait tablet has no room to show the conversation usefully beside it. */
  @media (max-width: 839.98px) {
    .side-panel.over {
      width: 100%;
    }
  }
  .side-panel.expanded {
    position: absolute;
    inset: 0;
    z-index: 30;
    width: auto;
    border-left: 0;
  }
  .bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.125rem;
    min-height: 3rem;
    padding: 0.25rem 0.5rem 0.25rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .bar > .tap:first-child {
    margin-left: -0.5rem;
  }
  .title {
    flex: 1;
    min-width: 0;
    font-size: var(--text-base);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    outline: none;
  }
  .tap {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border-radius: var(--radius);
    color: var(--muted-foreground);
  }
  .tap:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  .tap[aria-pressed="true"] {
    color: var(--foreground);
    background: var(--accent);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.75rem 1rem 1.5rem;
    /* Content lays itself out for the panel's width, not the window's. */
    container-type: inline-size;
  }
  .expanded .body > :global(*) {
    max-width: 64rem;
    margin-inline: auto;
  }
</style>
