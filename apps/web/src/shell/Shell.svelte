<script lang="ts">
  /**
   * One shell, three sizes (design language §1, §7). Expanded: the sidebar beside the screen.
   * Medium: the sidebar is a drawer over it. Compact: one screen at a time, and the session list
   * is the first. The address says which screen is shown, and which session.
   */
  import { onMount, tick, untrack } from "svelte";
  import { focusMain } from "../lib/focus";
  import { routeTitle } from "../routes";
  import { useSessions } from "../features/workspace/session-client.svelte";
  import { sessionName } from "../features/workspace/session-presentation";
  import NewSession from "../features/workspace/NewSession.svelte";
  import SessionScreen from "../features/workspace/SessionScreen.svelte";
  import ArchivedScreen from "../features/workspace/ArchivedScreen.svelte";
  import AgentsScreen from "../features/agent/AgentsScreen.svelte";
  import BackgroundScreen from "../features/background/BackgroundScreen.svelte";
  import SettingsScreen from "../features/settings/SettingsScreen.svelte";
  import Screen from "./Screen.svelte";
  import Sidebar from "./Sidebar.svelte";
  import NudgeHost from "./NudgeHost.svelte";
  import ToastHost from "./ToastHost.svelte";
  import { layout } from "./layout.svelte";
  import { router } from "./router.svelte";

  const sessions = useSessions();
  const route = $derived(router.route);
  const compact = $derived(layout.size === "compact");
  let drawer = $state<HTMLDialogElement>();

  // The session on screen is the one the address names.
  $effect(() => {
    const shown = route.name === "session" ? route.id : undefined;
    untrack(() => (shown ? void sessions.select(shown) : sessions.leave()));
  });
  // Going somewhere closes the drawer, starts the screen at its top and moves focus there, so
  // screen readers start on the new screen. The first screen keeps focus where the page put it.
  let first = true;
  $effect(() => {
    void route;
    untrack(() => {
      layout.drawerOpen = false;
      if (route.name === "agents") sessions.agents.enterRoute();
    });
    if (first) return void (first = false);
    void tick().then(() => focusMain());
  });
  $effect(() => {
    if (!drawer) return;
    if (layout.drawerOpen && !drawer.open) drawer.showModal();
    else if (!layout.drawerOpen && drawer.open) drawer.close();
  });
  onMount(() => router.sync());

  const title = $derived(
    route.name === "session" && sessions.current?.info ? sessionName(sessions.current.info) : routeTitle(route),
  );

  function shortcut(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "b") return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector("dialog[open]:not(.drawer)")) return;
    event.preventDefault();
    layout.toggleSidebar();
  }
  function drawerClosed() {
    layout.drawerOpen = false;
    document.querySelector<HTMLElement>("[data-sidebar-toggle]")?.focus();
  }
</script>

<svelte:window onkeydown={shortcut} />
<svelte:head><title>PiSpark — {title}</title></svelte:head>

<div class="shell" data-size={layout.size}>
  {#if layout.sidebarShown}<aside class="sidebar" aria-label="Sidebar"><Sidebar /></aside>{/if}

  <div class="content">
    {#if route.name === "home" && compact}
      <main id="main" class="list-screen" aria-label="Sessions" tabindex="-1"><Sidebar screen /></main>
      <NudgeHost />
      <ToastHost bottom="calc(4.5rem + env(safe-area-inset-bottom))" />
    {:else if route.name === "home" || route.name === "new"}
      <NewSession />
    {:else if route.name === "session"}
      {#if sessions.current?.id === route.id}
        {#key route.id}<SessionScreen session={sessions.current} />{/key}
      {:else}
        <Screen title="Session"><p role="status" class="text-sm text-muted-foreground">Opening…</p></Screen>
      {/if}
    {:else if route.name === "archived"}
      <ArchivedScreen />
    {:else if route.name === "agents"}
      <AgentsScreen id={route.id} />
    {:else if route.name === "background"}
      <BackgroundScreen />
    {:else}
      <SettingsScreen section={route.section} />
    {/if}
  </div>

  {#if layout.size === "medium"}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <dialog
      bind:this={drawer}
      class="drawer"
      aria-label="Sessions"
      onclose={drawerClosed}
      onclick={(event) => event.target === drawer && drawer?.close()}
    >
      {#if layout.drawerOpen}<Sidebar />{/if}
    </dialog>
  {/if}
</div>

<style>
  .shell {
    display: flex;
    height: 100dvh;
    overflow: hidden;
    background: var(--background);
    color: var(--foreground);
  }
  .sidebar {
    width: 272px;
    flex-shrink: 0;
    border-right: 1px solid var(--sidebar-border);
  }
  /* Below expanded the sidebar is a drawer or the first screen: gone from the first frame of a resize. */
  @media (max-width: 1023.98px) {
    .sidebar {
      display: none;
    }
  }
  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    position: relative;
  }
  .list-screen {
    flex: 1;
    min-width: 0;
    outline: none;
  }
  .drawer {
    margin: 0;
    width: min(320px, 85vw);
    max-width: none;
    height: 100dvh;
    max-height: none;
    padding: 0;
    border: 0;
    border-right: 1px solid var(--border);
    background: var(--sidebar);
    color: var(--foreground);
    box-shadow: var(--shadow-popover);
  }
  .drawer[open] {
    animation: drawer-in 0.18s ease-out;
  }
  .drawer::backdrop {
    background: rgb(0 0 0 / 0.32);
  }
  @keyframes drawer-in {
    from {
      transform: translateX(-100%);
    }
  }
</style>
