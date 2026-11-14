<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import SessionMark from "./SessionMark.svelte";
  import { useSessions } from "./session-client.svelte";
  import { canArchive, sessionStatus } from "./session-presentation";
  import { describeSchedule } from "../../../../server/src/contract/cron";
  import type { SessionInfo } from "../../../../server/src/contract/protocol";
  /**
   * A session in the sidebar: its name opens it, its mark says its state, and Archive (shown on
   * hover or focus) puts it away into the Archived list.
   */
  let {
    session,
    name,
    children,
    before,
    status,
    class: className = "",
  }: {
    session: SessionInfo;
    /** What the row is called, for the Archive button's name. */
    name: string;
    children: Snippet;
    /** A control at the start of the row, such as the toggle for the sessions it started. */
    before?: Snippet;
    /** The mark to show instead of the session's own, such as the foremost of it and its children. */
    status?: string;
    class?: string;
  } = $props();
  const client = useSessions();
  // Nothing to offer while the session runs, waits or is queued: its mark says so.
  const archivable = $derived(canArchive(session));
  const scheduled = $derived(client.schedules.active(session.id));
  let row = $state<HTMLElement>();

  async function archive() {
    // The row goes away: focus moves to the next session in the sidebar, else the one before.
    const links = [...document.querySelectorAll<HTMLElement>("[data-session-link]")];
    const at = links.findIndex((link) => row?.contains(link));
    const neighbour = (links[at + 1] ?? links[at - 1])?.dataset.sessionLink;
    if (!(await client.archive(session.id))) return;
    await tick();
    const next = neighbour && document.querySelector<HTMLElement>(`[data-session-link="${neighbour}"]`);
    if (next) next.focus();
    else document.querySelector<HTMLElement>('nav[aria-label="Chats"] button')?.focus();
  }
</script>

<div class="nav-item session-row {className}" bind:this={row}>
  {@render before?.()}
  <a
    href="#/workspace"
    class="flex min-w-0 flex-1 items-center gap-2.5"
    data-session-link={session.id}
    aria-current={session.id === client.selected ? "page" : undefined}
    onclick={() => client.select(session.id)}>{@render children()}</a
  >
  {#if scheduled}<span class="scheduled" title={`Scheduled: ${describeSchedule(scheduled)}`}
      ><Icon name="clock" class="h-3.5 w-3.5" /><span class="sr-only">Scheduled: {describeSchedule(scheduled)}</span></span
    >{/if}
  {#if session.held}<span class="scheduled kept" title={`Kept running by ${session.held.extension}: ${session.held.reason}`}
      ><Icon name="pin" class="h-3.5 w-3.5" /><span class="sr-only">Kept running by {session.held.extension}</span></span
    >{/if}
  {#if session.processes}<span class="scheduled kept" title={`${session.processes} ${session.processes === 1 ? "process" : "processes"} running`}
      ><Icon name="terminal" class="h-3.5 w-3.5" /><span class="sr-only"
        >{session.processes} {session.processes === 1 ? "process" : "processes"} running</span
      ></span
    >{/if}
  <SessionMark status={status ?? sessionStatus(session)} />
  {#if archivable}<button type="button" class="row-action" aria-label={`Archive ${name}`} title="Archive" onclick={archive}
      ><Icon name="archive" class="h-4 w-4" /></button
    >{/if}
</div>

<style>
  .session-row {
    position: relative;
  }
  .scheduled {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    color: var(--subtle-foreground);
  }
  .kept {
    color: var(--interactive-text);
  }
  .session-row:focus-within {
    background: var(--sidebar-hover);
  }
  /* The row is two controls; it is marked as the place you are through its link. */
  .session-row:has(a[aria-current="page"]) {
    background: var(--sidebar-accent);
    font-weight: 500;
  }
  /*
   * Over the end of the row, and only when the row is pointed at or reached by keyboard, so a
   * name keeps its whole width the rest of the time. Without a pointer it is always there.
   */
  .row-action {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    display: inline-grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.375rem;
    color: var(--muted-foreground);
    background: var(--sidebar-hover);
    /* The name fades out under it rather than being cut. */
    box-shadow: -0.75rem 0 0.5rem 0.125rem var(--sidebar-hover);
    opacity: 0;
  }
  .session-row:has(a[aria-current="page"]) .row-action {
    background: var(--sidebar-accent);
    box-shadow: -0.75rem 0 0.5rem 0.125rem var(--sidebar-accent);
  }
  .session-row:hover .row-action,
  .session-row:focus-within .row-action {
    opacity: 1;
  }
  .row-action:hover {
    color: var(--foreground);
  }
  @media (hover: none) {
    .row-action {
      position: static;
      transform: none;
      opacity: 1;
      background: none;
      box-shadow: none;
    }
  }
</style>
