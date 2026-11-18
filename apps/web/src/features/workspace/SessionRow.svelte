<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Modal from "../../lib/ui/Modal.svelte";
  import IdentityMark from "../../lib/ui/IdentityMark.svelte";
  import InlineEdit from "../../lib/ui/InlineEdit.svelte";
  import SessionMark from "./SessionMark.svelte";
  import { useSessions } from "./session-client.svelte";
  import { canArchive, sessionState, type SessionState } from "./session-presentation";
  import { describeSchedule } from "../../../../server/src/contract/cron";
  import { DEFAULT_AGENT } from "../../../../server/src/contract/agent-protocol";
  import type { SessionInfo } from "../../../../server/src/contract/protocol";
  import { href } from "../../routes";
  /**
   * A session in the sidebar, on one line: its agent's mark when it isn't Default, its name, what
   * runs in the background for it, and its state. Rename (in place) and Archive show on hover or
   * focus; on a touch screen a long press (or a right-click anywhere) opens the row's actions in a sheet.
   */
  let {
    session,
    name,
    muted = false,
    before,
    status,
    class: className = "",
  }: {
    session: SessionInfo;
    name: string;
    /** The name is a stand-in (an app's untitled session). */
    muted?: boolean;
    /** A control at the start of the row, such as the toggle for the sessions it started. */
    before?: Snippet;
    /** The mark to show instead of the session's own, such as the foremost of it and its children. */
    status?: SessionState;
    class?: string;
  } = $props();
  const client = useSessions();
  const archivable = $derived(canArchive(session));
  const scheduled = $derived(client.schedules.active(session.id));
  // An app's sessions are listed under the app, so its mark would only repeat it.
  const agent = $derived(session.agent && session.agent.id !== DEFAULT_AGENT && !session.agent.home ? session.agent.name : undefined);
  let row = $state<HTMLElement>();
  /** The row's actions, opened by a long press or a right-click. */
  let actions = $state(false);
  let renaming = $state(false);
  function startRename() {
    actions = false;
    renaming = true;
  }
  let press: ReturnType<typeof setTimeout> | undefined;
  let pressed = false;
  function pressStart(event: PointerEvent) {
    if (event.pointerType !== "touch") return;
    pressed = false;
    press = setTimeout(() => {
      pressed = true;
      actions = true;
    }, 500);
  }
  const pressEnd = () => clearTimeout(press);
  async function archive() {
    // The row goes away: focus moves to the next session in the sidebar, else the one before.
    const links = [...document.querySelectorAll<HTMLElement>("[data-session-link]")];
    const at = links.findIndex((link) => row?.contains(link));
    const neighbour = (links[at + 1] ?? links[at - 1])?.dataset.sessionLink;
    actions = false;
    if (!(await client.archive(session.id))) return;
    await tick();
    const next = neighbour && document.querySelector<HTMLElement>(`[data-session-link="${neighbour}"]`);
    if (next) next.focus();
    else document.querySelector<HTMLElement>('nav[aria-label="Sessions"] a, nav[aria-label="Sessions"] button')?.focus();
  }
</script>

<div class="nav-item session-row {className}" bind:this={row}>
  {@render before?.()}
  {#if renaming}
    <InlineEdit
      value={session.title ?? ""}
      label="Name"
      onsave={(title) => client.rename(session.id, title)}
      ondone={() => {
        renaming = false;
        void tick().then(() => row?.querySelector<HTMLElement>("[data-rename]")?.focus());
      }}
    />
  {:else}<a
    href={href({ name: "session", id: session.id })}
    class="flex min-w-0 flex-1 items-center gap-2"
    data-session-link={session.id}
    aria-current={session.id === client.selected ? "page" : undefined}
    onpointerdown={pressStart}
    onpointerup={pressEnd}
    onpointercancel={pressEnd}
    onpointermove={pressEnd}
    oncontextmenu={(event) => {
      event.preventDefault();
      clearTimeout(press);
      actions = true;
    }}
    onclick={(event) => {
      // The long press opened the actions; the touch that ends it doesn't also open the session.
      if (pressed) {
        event.preventDefault();
        pressed = false;
      }
    }}
  >
    {#if agent}<span class="inline-flex" title={agent}><IdentityMark name={agent} /><span class="sr-only">{agent}:</span></span>{/if}
    <span class="min-w-0 flex-1 truncate" class:text-muted-foreground={muted} class:unread={session.unread}>{name}</span>
  </a>{/if}
  {#if scheduled}<span class="background" title={`Scheduled: ${describeSchedule(scheduled)}`}
      ><Icon name="clock" class="h-3.5 w-3.5" /><span class="sr-only">Scheduled: {describeSchedule(scheduled)}</span></span
    >{/if}
  {#if session.held}<span class="background" title={`Kept running by ${session.held.extension}: ${session.held.reason}`}
      ><Icon name="pin" class="h-3.5 w-3.5" /><span class="sr-only">Kept running by {session.held.extension}</span></span
    >{/if}
  {#if session.processes}<span class="background" title={`${session.processes} ${session.processes === 1 ? "background task" : "background tasks"} running`}
      ><Icon name="terminal" class="h-3.5 w-3.5" /><span class="sr-only"
        >{session.processes} {session.processes === 1 ? "background task" : "background tasks"} running</span
      ></span
    >{/if}
  <SessionMark state={status ?? sessionState(session)} />
  {#if session.unread && !(status ?? sessionState(session))}<span class="unread-dot" title="New since you looked"
      ><span class="sr-only">New since you looked</span></span
    >{/if}
  {#if !renaming}<span class="row-actions">
      <button type="button" class="row-action" data-rename aria-label={`Rename ${name}`} title="Rename" onclick={startRename}
        ><Icon name="pencil" class="h-3.5 w-3.5" /></button
      >{#if archivable}<button type="button" class="row-action" aria-label={`Archive ${name}`} title="Archive" onclick={archive}
          ><Icon name="archive" class="h-4 w-4" /></button
        >{/if}
    </span>{/if}
</div>

{#if actions}
  <Modal label={name} title={name} size="small" onclose={() => (actions = false)}>
    <div class="flex flex-col gap-2">
      <Button onclick={startRename}><Icon name="pencil" class="h-4 w-4" />Rename</Button>
      {#if archivable}<Button onclick={() => void archive()}><Icon name="archive" class="h-4 w-4" />Archive</Button>{/if}
    </div>
  </Modal>
{/if}

<style>
  .session-row {
    position: relative;
    min-height: 2rem;
    padding-top: 0.25rem;
    padding-bottom: 0.25rem;
  }
  /* New since you looked (on any device): the name stands out and a dot says so (design set 9/2). */
  .unread {
    font-weight: 600;
  }
  .unread-dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    margin-inline: 0.25rem;
    border-radius: var(--radius-full);
    background: var(--interactive);
  }
  .background {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    color: var(--muted-foreground);
  }
  .session-row:focus-within {
    background: var(--sidebar-hover);
  }
  /* The row is two controls; it is marked as the place you are through its link. */
  .session-row:has(a[aria-current="page"]) {
    background: var(--sidebar-accent);
    font-weight: 500;
  }
  /* Over the end of the row when pointed at or reached by keyboard, so the name keeps its width. */
  .row-actions {
    position: absolute;
    right: 0.375rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    background: var(--sidebar-hover);
    box-shadow: -0.75rem 0 0.5rem 0.125rem var(--sidebar-hover);
    border-radius: var(--radius-sm);
    opacity: 0;
  }
  .session-row:has(a[aria-current="page"]) .row-actions {
    background: var(--sidebar-accent);
    box-shadow: -0.75rem 0 0.5rem 0.125rem var(--sidebar-accent);
  }
  .session-row:hover .row-actions,
  .session-row:focus-within .row-actions {
    opacity: 1;
  }
  .row-action {
    display: inline-grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .row-action:hover {
    color: var(--foreground);
  }
  /* Touch: no hover, so the action stays in reach. */
  @media (hover: none) {
    .session-row {
      min-height: 2.75rem;
    }
    /* Reached by a long press instead; still there for a screen reader. */
    .row-actions {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      opacity: 1;
    }
    a {
      -webkit-touch-callout: none;
      user-select: none;
    }
  }
</style>
