<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import SessionRow from "./SessionRow.svelte";
  import { useSessions } from "./session-client.svelte";
  import { foremostStatus, sessionName, sessionStatus } from "./session-presentation";
  import type { SessionInfo } from "../../../../server/src/contract/protocol";
  /**
   * A session in the sidebar with the sessions it started under it. Closed, its mark speaks for them
   * too; it opens on its own while one of them works, waits for you, or is the one shown.
   */
  let {
    session,
    name,
    children,
    class: className = "",
  }: { session: SessionInfo; name: string; children: Snippet; class?: string } = $props();
  const client = useSessions();
  const id = $props.id();
  const started = $derived(client.sessions.filter((each) => each.parent === session.id));
  let toggled = $state<boolean>();
  const open = $derived(
    started.length > 0 && (toggled ?? started.some((each) => each.id === client.selected || ["Working…", "Waiting for you", "Queued"].includes(sessionStatus(each)))),
  );
</script>

<SessionRow {session} {name} class={className} status={started.length && !open ? foremostStatus([session, ...started].map(sessionStatus)) : undefined}>
  {@render children()}
  {#snippet before()}
    {#if started.length}<button
        type="button"
        class="tree-toggle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Sessions started by ${name}`}
        onclick={() => (toggled = !open)}><Icon name={open ? "chevronDown" : "chevronRight"} class="h-3.5 w-3.5" /></button
      >{/if}
  {/snippet}
</SessionRow>
{#if open}
  <div {id} class="started space-y-px" role="group" aria-label={`Started by ${name}`}>
    {#each started as child (child.id)}
      {@const childName = sessionName(child)}
      <SessionRow session={child} name={childName} class="child-session">
        <span class="min-w-0 flex-1 truncate">{childName}</span>
      </SessionRow>
    {/each}
  </div>
{/if}

<style>
  /* In the row's left gutter, so names stay aligned with rows that have no sessions under them. */
  .tree-toggle {
    position: absolute;
    left: -0.375rem;
    top: 50%;
    transform: translateY(-50%);
    display: inline-grid;
    place-items: center;
    width: 1.125rem;
    height: 1.5rem;
    border-radius: 0.25rem;
    color: var(--subtle-foreground);
  }
  .tree-toggle:hover {
    color: var(--foreground);
  }
  .started {
    margin: 0.125rem 0 0.25rem 1.125rem;
    padding-left: 0.375rem;
    border-left: 1px solid var(--sidebar-border);
  }
  :global(.child-session) {
    min-height: 2rem;
    padding-top: 0.3125rem;
    padding-bottom: 0.3125rem;
    font-size: 0.8125rem;
  }
</style>
