<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  import IdentityMark from "../../lib/ui/IdentityMark.svelte";
  import SessionMark from "./SessionMark.svelte";
  import SessionTree from "./SessionTree.svelte";
  import { useSessions } from "./session-client.svelte";
  import { foremostState, sessionStarted, sessionState } from "./session-presentation";
  import { validSessionTitle } from "../../../../server/src/contract/session-title";
  import type { AgentSummary } from "../../../../server/src/contract/agent-protocol";
  // An app agent in the sidebar: its name opens it, and its sessions are listed under it.
  let { app }: { app: AgentSummary } = $props();
  const client = useSessions();
  const id = $props.id();
  const sessions = $derived(client.appSessions(app.id));
  const current = $derived(sessions.some((session) => session.id === client.selected));
  // Closed until asked for, except around the session that is open.
  let toggled = $state<boolean>();
  const open = $derived((toggled ?? current) && sessions.length > 0);
</script>

<div class="nav-item app-row">
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-2 text-left"
    aria-current={current && !open ? "page" : undefined}
    onclick={() => client.openApp(app.id)}
  >
    <IdentityMark name={app.name} />
    <span class="truncate">{app.name}</span>
  </button>
  <!-- Closed, the row speaks for its sessions; open, each speaks for itself. -->
  {#if !open}<SessionMark state={foremostState(sessions.map(sessionState))} />{/if}
  {#if sessions.length}<button
      type="button"
      class="app-toggle"
      aria-expanded={open}
      aria-controls={id}
      aria-label={`Sessions of ${app.name}`}
      onclick={() => (toggled = !open)}><Icon name={open ? "chevronDown" : "chevronRight"} class="h-3.5 w-3.5" /></button
    >{/if}
</div>
{#if open}
  <div {id} class="space-y-px">
    {#each sessions as session (session.id)}
      {@const titled = validSessionTitle(session.title)}
      {@const name = titled ? session.title! : `Started ${sessionStarted(session)}`}
      <SessionTree {session} {name} muted={!titled} class="app-session" />
    {/each}
    <button type="button" class="nav-item app-session w-full text-muted-foreground" onclick={() => client.openApp(app.id, true)}>
      <Icon name="plus" class="h-3.5 w-3.5" />New session
    </button>
  </div>
{/if}

<style>
  .app-row {
    padding-right: 0.5rem;
  }
  /* The row is two controls; it is marked as the place you are through its link. */
  .app-row:has([aria-current="page"]) {
    background: var(--sidebar-accent);
    font-weight: 500;
  }
  .app-toggle {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 0.375rem;
    color: var(--subtle-foreground);
  }
  .app-toggle:hover {
    color: var(--foreground);
  }
  :global(.app-session) {
    padding-left: 2.5rem;
    font-size: var(--text-sm);
  }
</style>
