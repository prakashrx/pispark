<script lang="ts">
  import { onMount, tick } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import ConfirmDialog from "../../lib/ui/ConfirmDialog.svelte";
  import { focusMain } from "../../lib/focus";
  import Screen from "../../shell/Screen.svelte";
  import { useSessions } from "./session-client.svelte";
  import { goesByApp, sessionName, sessionStarted } from "./session-presentation";
  /**
   * The sessions a person archived (inventory L-14). Each can be restored, or deleted for good
   * after saying so: the only irreversible action on sessions.
   */
  const client = useSessions();
  let loading = $state(true);
  let failed = $state(false);
  /** The session whose deletion waits to be confirmed. */
  let confirming = $state<string>();
  let list = $state<HTMLElement>();

  async function load() {
    loading = true;
    failed = false;
    try {
      await client.loadArchived();
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }
  onMount(() => void load());

  const row = (id: string) => list?.querySelector<HTMLElement>(`[data-session="${id}"]`);
  let deleting = $state(false);
  const asked = $derived(client.archived?.find((session) => session.id === confirming));
  /** Restore or delete, then focus the next archived session, else the one before, else the screen. */
  async function act(id: string, action: "restore" | "delete") {
    const sessions = client.archived ?? [];
    const at = sessions.findIndex((session) => session.id === id);
    const neighbour = (sessions[at + 1] ?? sessions[at - 1])?.id;
    if (action === "delete") deleting = true;
    const done = await (action === "restore" ? client.restore(id) : client.delete(id));
    if (action === "delete") {
      deleting = false;
      if (done) confirming = undefined;
    }
    if (!done) return;
    await tick();
    // A restore can finish while a different session's delete confirmation is open.
    if (confirming) return;
    const next = neighbour ? row(neighbour)?.querySelector<HTMLElement>("button") : undefined;
    if (next) next.focus();
    else focusMain();
  }
</script>

<Screen title="Archived">
  {#if loading && !client.archived}
    <p role="status" class="text-sm text-muted-foreground">Loading archived sessions…</p>
  {:else if failed}
    <p role="alert" class="text-sm text-[var(--danger-foreground)]">
      Couldn’t load the archived sessions. <Button size="compact" onclick={load}>Try again</Button>
    </p>
  {:else}
    <ul bind:this={list} aria-label="Archived sessions">
      {#each client.archived ?? [] as session (session.id)}
        {@const name = sessionName(session)}
        <li class="line" data-session={session.id}>
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{name}</span>
              <span class="block truncate text-xs text-muted-foreground"
                >{goesByApp(session) ? "" : `${session.agent.name} · `}{sessionStarted(session)}</span
              >
            </span>
            <Button size="compact" aria-label={`Restore ${name}`} onclick={() => act(session.id, "restore")}>Restore</Button>
            <Button size="compact" variant="ghost" class="danger" aria-label={`Delete ${name}`} onclick={() => (confirming = session.id)}
              >Delete</Button
            >
          </div>
        </li>
      {:else}
        <p class="text-sm text-muted-foreground">Nothing archived. Archive a finished session from the session list.</p>
      {/each}
    </ul>
  {/if}
</Screen>

{#if asked}
  <ConfirmDialog
    title="Delete this session?"
    text={`“${sessionName(asked)}” and its messages are deleted from this computer. This can’t be undone.`}
    action="Delete session"
    busy={deleting}
    onconfirm={() => void act(asked.id, "delete")}
    oncancel={() => (confirming = undefined)}
  />
{/if}

<style>
  .line {
    padding: 0.625rem 0;
    border-bottom: 1px solid var(--border);
  }
  .line :global(.danger) {
    color: var(--danger-foreground);
  }
</style>
