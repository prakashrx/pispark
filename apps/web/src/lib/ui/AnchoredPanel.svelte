<script lang="ts" module>
  /** Compact: phones (design language §7). */
  const COMPACT = "(max-width: 599.98px)";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  /**
   * The panel of a popover, menu or picker. It hangs under its control and opens toward the
   * middle of the screen; on compact (phones) it is a sheet from the bottom with a scrim, a grab
   * handle and, for content without a heading of its own (menus, pickers), a title, closed by tapping outside, swiping down or Escape (the owner
   * handles Escape and focus). Place it inside a positioned wrapper around the control.
   *
   * The sheet goes in the browser's top layer, so no container (a blurred header, a
   * transform) can clip it, while it stays in the owner's DOM for focus and events.
   */
  let {
    title,
    onclose,
    children,
    class: className = "",
    ...rest
  }: {
    title?: string;
    onclose: () => void;
    children: Snippet;
    class?: string;
  } & Omit<HTMLAttributes<HTMLDivElement>, "children" | "class"> = $props();
  let layer: HTMLDivElement;
  let compact = $state(false);
  let align = $state<"start" | "end">("end");
  let pull = $state(0);
  let pullFrom: number | undefined;

  $effect(() => {
    const media = window.matchMedia?.(COMPACT);
    if (!media) return;
    const update = () => (compact = media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });
  $effect(() => {
    if (!("popover" in layer)) return;
    layer.popover = compact ? "manual" : null;
    if (compact) {
      layer.showPopover();
      // Android Back participates in the native close stack above the current route.
      if ("CloseWatcher" in window) {
        const Watcher = window.CloseWatcher as new () => EventTarget & { destroy(): void };
        const watcher = new Watcher();
        watcher.addEventListener("close", onclose);
        return () => watcher.destroy();
      }
    }
  });
  $effect(() => {
    const anchor = layer.parentElement?.getBoundingClientRect();
    if (anchor) align = anchor.left + anchor.width / 2 < window.innerWidth / 2 ? "start" : "end";
  });

  function grab(event: PointerEvent) {
    pullFrom = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function drag(event: PointerEvent) {
    if (pullFrom !== undefined) pull = Math.max(0, event.clientY - pullFrom);
  }
  function release() {
    if (pullFrom === undefined) return;
    pullFrom = undefined;
    if (pull > 64) onclose();
    pull = 0;
  }
</script>

<div bind:this={layer} class="layer">
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="sheet-scrim" onclick={onclose}></div>
  <div {...rest} class="anchored {className}" data-align={align} style:translate={pull ? `0 ${pull}px` : undefined}>
    <div class="sheet-head" aria-hidden="true" onpointerdown={grab} onpointermove={drag} onpointerup={release} onpointercancel={release}>
      <span class="sheet-grab"></span>
      {#if title}<span class="sheet-title">{title}</span>{/if}
    </div>
    {@render children()}
  </div>
</div>

<style>
  .layer {
    display: contents;
  }
  .anchored {
    position: absolute;
    top: 100%;
    z-index: 50;
    width: max-content;
    max-width: min(20rem, 85vw);
    margin-top: 0.25rem;
    padding: 0.25rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-popover);
    color: var(--foreground);
  }
  [data-align="start"] {
    left: 0;
  }
  [data-align="end"] {
    right: 0;
  }
  .sheet-scrim,
  .sheet-head {
    display: none;
  }

  /* Compact: the sheet, in the top layer. */
  .layer:popover-open {
    display: block;
    position: fixed;
    inset: 0;
    width: auto;
    height: auto;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    overflow: visible;
  }
  .layer:popover-open .sheet-scrim {
    display: block;
    position: absolute;
    inset: 0;
    background: rgb(0 0 0 / 0.32);
    animation: sheet-fade 0.2s ease-out;
  }
  .layer:popover-open .anchored {
    inset: auto 0 0;
    width: 100%;
    max-width: none;
    max-height: 85dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    margin: 0;
    padding: 0 0.5rem calc(0.5rem + env(safe-area-inset-bottom));
    border-width: 1px 0 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    animation: sheet-rise 0.2s ease-out;
  }
  .layer:popover-open .sheet-head {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0 0.75rem;
    background: var(--card);
    touch-action: none;
    cursor: grab;
  }
  .sheet-grab {
    width: 2.5rem;
    height: 0.25rem;
    border-radius: var(--radius-full);
    background: rgb(var(--n-300));
  }
  .sheet-title {
    font-size: var(--text-lg);
    font-weight: 600;
  }
  /* Rows a thumb can hit (design language §2.3: at least 48 px). */
  .layer:popover-open :global(:is([role="menuitem"], [role="option"])) {
    display: flex;
    align-items: center;
    min-height: 3rem;
    font-size: var(--text-base);
  }
  @keyframes sheet-rise {
    from {
      transform: translateY(100%);
    }
  }
  @keyframes sheet-fade {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .anchored,
    .sheet-scrim {
      animation: none;
    }
  }
</style>
