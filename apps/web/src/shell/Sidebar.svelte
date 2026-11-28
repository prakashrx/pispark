<script lang="ts">
  /**
   * The app's navigation (design language §1.1): New session and Search, Apps, sessions by date,
   * Archived; at the foot, app-wide facts worth knowing, then Agents, Background and Settings.
   * The same content is the sidebar on expanded, the drawer on medium and the first screen on
   * compact, where its three destinations become a bar at the bottom.
   */
  import { untrack } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import StatusMark from "../lib/ui/StatusMark.svelte";
  import AppEntry from "../features/workspace/AppEntry.svelte";
  import SessionTree from "../features/workspace/SessionTree.svelte";
  import SessionRow from "../features/workspace/SessionRow.svelte";
  import { useSessions } from "../features/workspace/session-client.svelte";
  import { dateGroups, sessionName, sessionState } from "../features/workspace/session-presentation";
  import { go, href, type Route } from "../routes";
  import { layout } from "./layout.svelte";
  import { router } from "./router.svelte";

  let { screen = false }: { screen?: boolean } = $props();
  const client = useSessions();
  let query = $state(untrack(() => (screen ? client.phoneList.query : "")));
  function restoreList(node: HTMLElement) {
    if (screen) node.scrollTop = client.phoneList.top;
  }
  let step = 0;

  const backend = $derived(
    ["Connected", "Live", "Unloaded"].includes(client.connection) ? "ok" : client.connection === "Disconnected" ? "offline" : "connecting",
  );
  const apps = $derived(client.agents.items.filter((agent) => agent.valid && agent.home));
  // Most recently active first (L-07): a session you just replied to is at the top, whenever it started.
  const newestFirst = $derived([...client.sessions].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)));
  // A session another one started is listed under it (when that one is listed), and an app's
  // sessions under the app.
  const listed = $derived(new Set(client.sessions.map((session) => session.id)));
  const roots = $derived(newestFirst.filter((session) => !session.agent?.home && !(session.parent && listed.has(session.parent))));
  $effect(() => {
    if (screen) client.phoneList.query = query;
  });
  const needle = $derived(query.trim().toLowerCase());
  const found = $derived(needle ? newestFirst.filter((session) => sessionName(session).toLowerCase().includes(needle)) : []);
  const groups = $derived(dateGroups(roots));
  // The open session moves to the top when it does something (L-07): keep its row in sight.
  let sessionsNav = $state<HTMLElement>();
  const openAt = $derived(newestFirst.findIndex((session) => session.id === client.selected));
  $effect(() => {
    if (openAt < 0) return;
    sessionsNav?.querySelector<HTMLElement>('a[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  });
  const needsYou = $derived(newestFirst.filter((session) => sessionState(session) === "needs-you"));
  // What can run without you: schedules, routines switched on, kept sessions and processes.
  const background = $derived(
    client.schedules.schedules.length +
      client.routines.routines.filter((routine) => routine.on).length +
      client.sessions.filter((session) => session.held).length +
      client.processes.running.length,
  );
  const route = $derived(router.route);
  const at = (name: Route["name"]) => (route.name === name ? "page" : undefined);

  function nextNeedingYou() {
    const session = needsYou[step++ % needsYou.length];
    if (session) go({ name: "session", id: session.id });
  }
</script>

<div class="sidebar" class:screen>
  <div class="head">
    <a href="#/" class="brand">
      <span class="brand-mark" aria-hidden="true">π</span>
      <span class="brand-name">PiSpark</span>
    </a>
    <!-- Quiet when the server is reached; otherwise said in words, not only colour. -->
    <span
      class="backend"
      data-state={backend}
      role="img"
      aria-label={`Backend: ${client.connection}`}
      title={`Backend: ${client.connection}`}
    >
      {#if backend !== "ok"}<span aria-hidden="true">{backend === "offline" ? "Offline" : "Connecting…"}</span>{/if}
    </span>
    <span class="grow"></span>
    {#if screen}
      <a class="new-round" href="#/new" aria-label="New session"><Icon name="plus" class="h-5 w-5" /></a>
    {:else if layout.size === "expanded"}
      <button type="button" class="tap" aria-label="Hide sidebar" aria-expanded="true" onclick={() => layout.toggleSidebar()}>
        <Icon name="collapse" class="h-4 w-4" />
      </button>
    {/if}
  </div>

  <div class="top">
    {#if !screen}<a class="new" href="#/new" aria-current={at("new")}><Icon name="plus" class="h-4 w-4" />New session</a>{/if}
    {#if client.sessions.length}<label class="search">
        <Icon name="search" class="h-4 w-4 text-muted-foreground" />
        <span class="sr-only">Search sessions</span>
        <input type="search" placeholder="Search" bind:value={query} />
      </label>{/if}
    {#if needsYou.length}<button type="button" class="need" onclick={nextNeedingYou}>
        <span aria-hidden="true" class="inline-flex"><StatusMark kind="attention" label="Needs you" /></span>
        <span>{needsYou.length} {needsYou.length === 1 ? "needs" : "need"} you</span>
      </button>{/if}
  </div>

  <div
    class="list"
    use:restoreList
    onscroll={(event) => {
      if (screen) client.phoneList.top = event.currentTarget.scrollTop;
    }}
  >
    {#if apps.length && !needle}
      <nav aria-label="Apps">
        <p class="label">Apps</p>
        <div class="space-y-px">
          {#each apps as app (app.id)}<AppEntry {app} />{/each}
        </div>
      </nav>
    {/if}
    <nav aria-label="Sessions" bind:this={sessionsNav}>
      {#if needle}
        <p class="label">Results</p>
        {#each found as session (session.id)}<SessionRow {session} name={sessionName(session)} />{:else}<p class="empty">
            No session matches “{query.trim()}”.
          </p>{/each}
      {:else}
        {#each groups as group (group.label)}
          <p class="label">{group.label}</p>
          <div class="space-y-px">
            {#each group.items as session (session.id)}<SessionTree {session} name={sessionName(session)} />{/each}
          </div>
        {:else}
          {#if screen && !client.catalogLoading && client.providers.noModel}
            <div class="first">
              <span class="brand-mark first-mark" aria-hidden="true">π</span>
              <p class="first-title">Welcome to PiSpark</p>
              <p class="first-text">Connect a model provider first, such as OpenAI or Anthropic. It takes a minute.</p>
              <a class="ui-button" data-variant="primary" href="#/settings/providers">Set up a provider</a>
            </div>
          {:else if screen && !client.catalogLoading}
            <div class="first">
              <span class="brand-mark first-mark" aria-hidden="true">π</span>
              <p class="first-title">No sessions yet</p>
              <p class="first-text">Ask anything to start one. Sessions keep running here, even with the browser closed.</p>
              <a class="ui-button" data-variant="primary" href="#/new">New session</a>
            </div>
          {:else}<p class="empty">No sessions yet.</p>{/if}
        {/each}
        {#if client.archivedCount}<a class="nav-item archived" href="#/archived" aria-current={at("archived")}>
            <Icon name="archive" class="h-4 w-4" /><span class="flex-1">Archived</span>
            <span class="count">{client.archivedCount}</span>
          </a>{/if}
      {/if}
    </nav>
  </div>

  <div class="foot" class:bar={screen}>
    {#if client.host.available}<a class="footrow" href={href({ name: "settings", section: "about" })} data-purpose="update-available">
        <Icon name="arrowUp" class="h-4 w-4 shrink-0" /><span class="flex-1 truncate">Update available · v{client.host.available}</span>
      </a>{/if}
    {#if client.schedules.paused}<a class="footrow" href={href({ name: "background" })} data-purpose="runs-paused">
        <Icon name="clock" class="h-4 w-4 shrink-0" /><span class="flex-1 truncate">Unattended runs paused</span>
      </a>{/if}
    <div class="dests">
      <a class="nav-item" href="#/agents" aria-current={at("agents")} onclick={() => client.agents.collection()}>
        <Icon name="people" class="h-4 w-4" /><span class="name">Agents</span>
      </a>
      <a class="nav-item" href="#/background" aria-current={at("background")}>
        <Icon name="clock" class="h-4 w-4" /><span class="name">Background</span>{#if background}<span class="count">
            <span class="sr-only">: </span>{background}
          </span>{/if}
      </a>
      <a class="nav-item" href="#/settings" aria-current={at("settings")}>
        <Icon name="settings" class="h-4 w-4" /><span class="name">Settings</span>
      </a>
    </div>
  </div>
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--sidebar);
    color: var(--sidebar-foreground);
  }
  .sidebar.screen {
    background: var(--background);
  }
  .screen :global([data-session-link]) {
    font-size: 1rem;
    letter-spacing: -0.01em;
  }
  .screen .label {
    padding-top: 0.55rem;
    padding-bottom: 0.125rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 3rem;
    padding: 0.25rem 0.5rem 0.25rem 1rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: var(--radius-sm);
  }
  .brand-name {
    font-size: var(--text-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  /* PiSpark's own mark: π on the theme's brand gradient. */
  .brand-mark {
    display: inline-grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    background: var(--brand-gradient);
    color: #fff;
    font-weight: 700;
    line-height: 1;
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.12),
      inset 0 1px 0 rgb(255 255 255 / 0.25);
  }
  .backend {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .backend[data-state="offline"] {
    color: var(--danger-foreground);
  }
  .backend[data-state="connecting"] {
    color: var(--muted-foreground);
  }
  /* A small dot always; words only when the server isn't reached. */
  .backend::before {
    content: "";
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: var(--radius-full);
    background: currentColor;
  }
  .backend[data-state="ok"] {
    color: var(--success);
  }
  .backend[data-state="connecting"]::before {
    animation: backend-pulse 2s ease-in-out infinite;
  }
  @keyframes backend-pulse {
    50% {
      opacity: 0.4;
    }
  }
  .grow {
    flex: 1;
  }
  .tap {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .tap:hover {
    background: var(--sidebar-hover);
    color: var(--foreground);
  }
  .new-round {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-full);
    background: var(--interactive);
    color: var(--interactive-foreground);
  }
  .top {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.25rem 0.75rem 0.5rem;
  }
  .new {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    padding: 0 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--background);
    font-size: var(--text-md);
    font-weight: 500;
  }
  .new:hover {
    background: var(--sidebar-hover);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
    padding: 0 0.75rem;
    border-radius: var(--radius);
    background: var(--muted);
  }
  .search:focus-within {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    padding: 0;
    background: transparent;
    font-size: var(--text-md);
    outline: none;
  }
  .need {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
    padding: 0 0.75rem;
    border-radius: var(--radius);
    border: 1.5px solid var(--interactive);
    background: var(--interactive-muted);
    color: var(--interactive-text);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0.5rem 0.75rem;
  }
  .label {
    padding: 0.75rem 0.75rem 0.25rem;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--subtle-foreground);
  }
  .empty {
    padding: 0.75rem;
    font-size: var(--text-md);
    color: var(--muted-foreground);
  }
  .archived {
    margin-top: 0.5rem;
    color: var(--muted-foreground);
  }
  .count {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .first {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 3rem 1rem 1rem;
    text-align: center;
  }
  .first-mark {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-md);
    font-size: var(--text-xl);
    margin-bottom: 0.25rem;
  }
  .first-title {
    font-weight: 600;
  }
  .first-text {
    max-width: 18rem;
    margin-bottom: 0.25rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .foot {
    padding: 0.5rem;
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom));
    border-top: 1px solid var(--sidebar-border);
  }
  .dests {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .dests .name {
    flex: 1;
  }
  .footrow {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2.25rem;
    margin-bottom: 0.25rem;
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius-sm);
    background: var(--muted);
    font-size: var(--text-sm);
  }
  /* Phone: the three destinations side by side, icon over label, like a tab bar. */
  .bar {
    padding-top: 0.25rem;
    padding-bottom: calc(0.25rem + env(safe-area-inset-bottom));
  }
  .bar .dests {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
  }
  .bar .dests .nav-item {
    position: relative;
    flex-direction: column;
    justify-content: center;
    gap: 0.125rem;
    min-height: 3.25rem;
    padding: 0.375rem 0;
  }
  .bar .dests .name {
    flex: none;
    font-size: var(--text-xs);
  }
  .bar .dests .count {
    position: absolute;
    top: 0.25rem;
    left: calc(50% + 0.5rem);
    min-width: 1rem;
    padding: 0 0.25rem;
    border-radius: var(--radius-full);
    background: var(--foreground);
    color: var(--background);
    font-size: var(--text-2xs);
    font-weight: 700;
  }
</style>
