<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  import SessionMark from "./SessionMark.svelte";
  import SessionTree from "./SessionTree.svelte";
  import { useSessions } from "./session-client.svelte";
  import { foremostStatus, sessionStarted, sessionStatus } from "./session-presentation";
  import { validChatTitle } from "../../../../server/src/contract/chat-title";
  import type { PersonaSummary } from "../../../../server/src/contract/persona-protocol";
  // An app persona in the sidebar: its name opens it, and its sessions are listed under it.
  let { app }: { app: PersonaSummary } = $props();
  const client = useSessions();
  const id = $props.id();
  const sessions = $derived(client.appSessions(app.id));
  const current = $derived(sessions.some((session) => session.id === client.selected));
  // Closed until asked for, except around the session that is open.
  let toggled = $state<boolean>();
  const open = $derived((toggled ?? current) && sessions.length > 0);
</script>

<div class="nav-item app-row">
  <a
    href="#/workspace"
    class="flex min-w-0 flex-1 items-center gap-2.5"
    aria-current={current && !open ? "page" : undefined}
    onclick={() => client.openApp(app.id)}
  >
    <span class="app-mark" aria-hidden="true">{app.name.trim().charAt(0).toUpperCase()}</span>
    <span class="truncate">{app.name}</span>
  </a>
  <!-- Closed, the row speaks for its sessions; open, each speaks for itself. -->
  {#if !open}<SessionMark status={foremostStatus(sessions.map(sessionStatus))} />{/if}
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
      {@const titled = validChatTitle(session.title)}
      {@const name = titled ? session.title! : `Started ${sessionStarted(session)}`}
      <SessionTree {session} {name} class="app-session">
        <span class="min-w-0 flex-1 truncate" class:text-muted-foreground={!titled}>{name}</span>
      </SessionTree>
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
  .app-row:has(a[aria-current="page"]) {
    background: var(--sidebar-accent);
    font-weight: 500;
  }
  .app-mark {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.375rem;
    background: var(--chip);
    color: var(--muted-foreground);
    font-size: 0.6875rem;
    font-weight: 600;
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
    min-height: 2rem;
    padding: 0.3125rem 0.5rem 0.3125rem 2.75rem;
    font-size: 0.8125rem;
  }
</style>
