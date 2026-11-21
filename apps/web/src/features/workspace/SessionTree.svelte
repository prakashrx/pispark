<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  import SessionTree from "./SessionTree.svelte";
  import SessionRow from "./SessionRow.svelte";
  import { useSessions } from "./session-client.svelte";
  import { foremostState, sessionName, sessionState } from "./session-presentation";
  import type { SessionInfo } from "../../../../server/src/contract/protocol";
  /**
   * A session in the sidebar with the sessions it started under it. Closed, its mark speaks for them
   * too; it opens on its own while one of them works, waits for you, or is the one shown.
   */
  let {
    session,
    name,
    muted = false,
    class: className = "",
  }: { session: SessionInfo; name: string; muted?: boolean; class?: string } = $props();
  const client = useSessions();
  const id = $props.id();
  const started = $derived(client.sessions.filter((each) => each.parent === session.id));
  const hasFork = $derived(started.some((each) => each.forkOf));
  const byId = $derived(new Map(client.sessions.map((each) => [each.id, each])));
  function isUnder(id: string, ancestor: string) {
    const seen = new Set<string>();
    for (let parent = byId.get(id)?.parent; parent && !seen.has(parent); parent = byId.get(parent)?.parent) {
      if (parent === ancestor) return true;
      seen.add(parent);
    }
    return false;
  }
  let toggled = $state<boolean>();
  const open = $derived(
    started.length > 0 && (toggled ?? ((client.selected && isUnder(client.selected, session.id)) || started.some((each) => ["working", "needs-you", "queued"].includes(sessionState(each))))),
  );
</script>

<SessionRow {session} {name} {muted} class={className} status={started.length && !open ? foremostState([session, ...started].map(sessionState)) : undefined}>
  {#snippet before()}
    {#if started.length}<button
        type="button"
        class="tree-toggle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={hasFork ? `Sessions under ${name}` : `Sessions started by ${name}`}
        onclick={() => (toggled = !open)}><Icon name={open ? "chevronDown" : "chevronRight"} class="h-3.5 w-3.5" /></button
      >{/if}
  {/snippet}
</SessionRow>
{#if open}
  <div {id} class="started space-y-px" role="group" aria-label={hasFork ? `Under ${name}` : `Started by ${name}`}>
    {#each started as child (child.id)}
      <SessionTree session={child} name={sessionName(child)} class="child-session" />
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
    font-size: var(--text-sm);
  }
</style>
