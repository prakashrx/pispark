<script lang="ts">
  import { tick } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { focusMain } from "../../lib/focus";
  import { useSessions } from "./session-client.svelte";
  import { goesByApp, sessionName, sessionStarted } from "./session-presentation";
  /**
   * The sessions a person archived, folded at the end of the chat list. Each can be restored, or
   * deleted for good after saying so.
   */
  const client = useSessions();
  const id = $props.id();
  let open = $state(false);
  /** The session whose deletion waits to be confirmed. */
  let confirming = $state<string>();
  let list = $state<HTMLElement>();
  let toggle = $state<HTMLElement>();
  // With nothing archived the section goes; when it comes back, it starts folded.
  $effect(() => {
    if (client.archivedCount) return;
    open = false;
    confirming = undefined;
  });

  async function unfold() {
    open = !open;
    confirming = undefined;
    if (open) await client.loadArchived().catch(() => {});
  }
  const row = (sessionId: string) => list?.querySelector<HTMLElement>(`[data-session="${sessionId}"]`);
  async function ask(sessionId: string) {
    confirming = sessionId;
    await tick();
    row(sessionId)?.querySelector<HTMLElement>("[data-cancel]")?.focus();
  }
  async function cancel(sessionId: string) {
    confirming = undefined;
    await tick();
    row(sessionId)?.querySelector<HTMLElement>("[data-delete]")?.focus();
  }
  const escape = (sessionId: string) => (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    void cancel(sessionId);
  };
  /** Restore or delete, then focus the next archived session, else the toggle, else the page. */
  async function act(sessionId: string, action: "restore" | "delete") {
    const sessions = client.archived ?? [];
    const at = sessions.findIndex((session) => session.id === sessionId);
    const neighbour = (sessions[at + 1] ?? sessions[at - 1])?.id;
    if (!(await (action === "restore" ? client.restore(sessionId) : client.delete(sessionId)))) return;
    confirming = undefined;
    await tick();
    const next = neighbour ? row(neighbour)?.querySelector<HTMLElement>("button") : undefined;
    if (next) next.focus();
    else if (client.archivedCount) toggle?.focus();
    else focusMain();
  }
</script>

{#if client.archivedCount}
  <div class="pt-2">
    <button
      type="button"
      class="nav-item w-full text-muted-foreground"
      bind:this={toggle}
      aria-expanded={open}
      aria-controls={id}
      onclick={unfold}
    >
      <Icon name="archive" class="h-4 w-4" /><span class="flex-1 text-left">Archived ({client.archivedCount})</span><Icon
        name={open ? "chevronDown" : "chevronRight"}
        class="h-3.5 w-3.5"
      />
    </button>
    {#if open}
      <ul {id} bind:this={list} class="space-y-px" aria-label="Archived chats">
        {#each client.archived ?? [] as session (session.id)}
          {@const name = sessionName(session)}
          <li class="archived-row" data-session={session.id}>
            <span class="block truncate">{name}</span>
            <span class="block truncate text-xs text-subtle"
              >{goesByApp(session) ? "" : `${session.persona.name} · `}{sessionStarted(session)}</span
            >
            <div class="row-actions">
              <button type="button" aria-label={`Restore ${name}`} title="Restore" onclick={() => act(session.id, "restore")}
                ><Icon name="restore" class="h-4 w-4" /></button
              >
              <button
                type="button"
                data-delete
                aria-label={`Delete ${name}`}
                title="Delete"
                onclick={() => ask(session.id)}><Icon name="trash" class="h-4 w-4" /></button
              >
            </div>
            {#if confirming === session.id}
              <div class="mt-1.5 space-y-1.5" role="group" aria-label={`Delete ${name}`}>
                <p class="text-xs text-[var(--danger-foreground)]">Delete permanently? This can’t be undone.</p>
                <div class="flex gap-1.5">
                  <Button size="compact" variant="destructive" onkeydown={escape(session.id)} onclick={() => act(session.id, "delete")}
                    >Delete</Button
                  >
                  <Button size="compact" data-cancel onkeydown={escape(session.id)} onclick={() => cancel(session.id)}>Cancel</Button>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .archived-row {
    position: relative;
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius);
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .archived-row:hover,
  .archived-row:focus-within {
    background: var(--sidebar-hover);
  }
  /* Over the end of the row when it is pointed at or reached by keyboard; always there without a pointer. */
  .row-actions {
    position: absolute;
    right: 0.375rem;
    top: 0.375rem;
    display: flex;
    gap: 0.125rem;
    background: var(--sidebar-hover);
    box-shadow: -0.75rem 0 0.5rem 0.125rem var(--sidebar-hover);
    opacity: 0;
  }
  .archived-row:hover .row-actions,
  .archived-row:focus-within .row-actions {
    opacity: 1;
  }
  .row-actions button {
    display: inline-grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.375rem;
    color: var(--muted-foreground);
  }
  .row-actions button:hover {
    color: var(--foreground);
    background: var(--sidebar-accent);
  }
  @media (hover: none) {
    .row-actions {
      position: static;
      opacity: 1;
      background: none;
      box-shadow: none;
      margin-top: 0.25rem;
    }
  }
</style>
