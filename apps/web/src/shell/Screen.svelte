<script lang="ts">
  /**
   * Every screen's frame (design language §1): the top bar, the app-wide banner, the screen's
   * notices, then Main, then the dock (a session's composer). Main is the screen's only scroll,
   * so the bars and the composer stay put.
   */
  import { setContext, type Snippet } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import InlineEdit from "../lib/ui/InlineEdit.svelte";
  import { href, type Route } from "../routes";
  import Banner from "./Banner.svelte";
  import NudgeHost from "./NudgeHost.svelte";
  import ToastHost from "./ToastHost.svelte";
  import { layout } from "./layout.svelte";

  let {
    title,
    back = { name: "home" },
    backLabel,
    hideTitle = false,
    rename,
    renaming = $bindable(false),
    actions,
    below,
    notices,
    children,
    dock,
    wide = false,
    flush = false,
    scroll = true,
  }: {
    title: string;
    /** Where back goes on compact. */
    back?: Route;
    /** A back link on every size, with these words beside it where there is room (a sub-screen). */
    backLabel?: string;
    /** The screen shows its own heading; the top bar shows no title. */
    hideTitle?: boolean;
    /** The title names something that can be renamed in place: a pencil beside it starts editing. */
    rename?: (title: string) => Promise<void>;
    /** Editing the title now (the pencil, or the screen's own Rename action). */
    renaming?: boolean;
    actions?: Snippet;
    /** A second row under the top bar (a session's view tabs on compact). */
    below?: Snippet;
    notices?: Snippet;
    children: Snippet;
    dock?: Snippet;
    /** Use Main's whole width instead of the reading column. */
    wide?: boolean;
    /** Main without padding or reading column: the content lays itself out (a conversation). */
    flush?: boolean;
    /** False when the content scrolls itself (it keeps its own place, as a conversation does). */
    scroll?: boolean;
  } = $props();

  const compact = $derived(layout.size === "compact");
  let main = $state<HTMLElement>();
  // What scrolls this screen, for content that follows its end or reads in above (a conversation).
  setContext("screen", { get main() { return main; } });
  const bar = $derived(compact || layout.menuShown || !hideTitle || !!actions);
</script>

<div class="screen">
  {#if bar}
    <header class="topbar">
      {#if !compact && layout.menuShown}
        <button
          type="button"
          class="tap"
          data-sidebar-toggle
          aria-label={layout.size === "medium" ? "Open sessions" : "Show sidebar"}
          aria-expanded="false"
          onclick={() => layout.toggleSidebar()}><Icon name="menu" class="h-5 w-5" /></button
        >
      {/if}
      {#if backLabel}
        <a class="crumb" href={href(back)} aria-label={backLabel}><Icon name="back" class="h-4 w-4" />{#if !compact}<span>{backLabel}</span>{/if}</a>
      {:else if compact}
        <a class="tap" href={href(back)} aria-label="Back"><Icon name="back" class="h-5 w-5" /></a>
      {/if}
      {#if hideTitle}<span class="grow"></span>
      {:else if rename && renaming}<div class="title editing">
          <InlineEdit
            value={title}
            label="Name"
            onsave={rename}
            ondone={() => {
              renaming = false;
              // Back to where editing began.
              queueMicrotask(() => document.querySelector<HTMLElement>("[data-rename-title]")?.focus());
            }}
          />
        </div>
      {:else if rename}<div class="title named">
          <h1>{title}</h1>
          <button type="button" class="pencil" data-rename-title aria-label={`Rename ${title}`} title="Rename" onclick={() => (renaming = true)}
            ><Icon name="pencil" class="h-3.5 w-3.5" /></button
          >
        </div>
      {:else}<h1 class="title">{title}</h1>{/if}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </header>
  {/if}
  <Banner />
  {#if below}<div class="below">{@render below()}</div>{/if}
  {#if notices}<div class="notices">{@render notices()}</div>{/if}
  <!-- Main, with the nudge over its top and the toast over its bottom (just above the dock). -->
  <div class="stage">
    <main id="main" aria-label={title} tabindex="-1" class:scroll class:flush bind:this={main}>
      {#if scroll && !flush}<div class="column" class:wide>{@render children()}</div>{:else}{@render children()}{/if}
    </main>
    <NudgeHost />
    <ToastHost />
  </div>
  {#if dock}<div class="dock" class:flush><div class="column">{@render dock()}</div></div>{/if}
</div>

<style>
  .screen {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .topbar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 3rem;
    padding: 0.25rem 0.5rem 0.25rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .tap {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    flex-shrink: 0;
    border-radius: var(--radius);
    color: var(--muted-foreground);
  }
  .tap:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  .crumb {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2.5rem;
    padding: 0 0.5rem;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .crumb:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  .title {
    flex: 1;
    min-width: 0;
    padding: 0 0.375rem;
    font-size: var(--text-base);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .named {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .named h1 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font: inherit;
  }
  .editing {
    display: flex;
    overflow: visible;
  }
  /* Quiet until you reach for it: faint beside the title, clear on hover or focus. */
  .pencil {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
    opacity: 0.55;
  }
  .pencil:hover,
  .pencil:focus-visible {
    opacity: 1;
    background: var(--accent);
    color: var(--foreground);
  }
  .grow {
    flex: 1;
  }
  @media (pointer: coarse) {
    .actions :global(.ui-button[aria-haspopup]), .actions :global([data-details-toggle]) {
      min-width: 44px;
      min-height: 44px;
    }
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex-shrink: 0;
  }
  .below {
    flex-shrink: 0;
    padding: 0.25rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .below:empty {
    display: none;
  }
  .notices {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem 0;
  }
  .notices:empty {
    display: none;
  }
  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    outline: none;
  }
  main.scroll {
    display: block;
    overflow-y: auto;
    padding: 1.5rem 1rem 3rem;
  }
  main.scroll.flush {
    padding: 0;
  }
  .column {
    max-width: 48rem;
    margin: 0 auto;
  }
  .column.wide {
    max-width: none;
  }
  .dock {
    flex-shrink: 0;
    padding: 0 1rem calc(0.5rem + env(safe-area-inset-bottom));
  }
  .dock.flush { padding-inline: var(--conversation-gutter); }
  .dock.flush .column { max-width: var(--conversation-width); }
  @media (max-width: 599.98px) {
    .topbar {
      padding-left: 0.25rem;
    }
    main.scroll {
      padding: 1rem 0.875rem 2rem;
    }
    .dock {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }
  }
</style>
