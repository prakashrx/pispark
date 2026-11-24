<script lang="ts">
  /**
   * Shows once a resource has changes that aren't saved: where they will go, and the choices that
   * matter there. A new one goes to the Shared library unless it's for this agent only; a change
   * to a shared one says how many agents it reaches. It saves and discards itself, so every tab
   * places it the same way: `<SaveBar {page} {item} />` under the editor.
   */
  import { isFresh, KINDS, NAME, type AgentPage, type Kind, type Row } from "./agent-page.svelte";

  let { page, item }: { page: AgentPage; item: Row } = $props();

  const one = $derived(KINDS[item.type as Kind].one);
  const reach = $derived(page.reach(item));
  const fresh = $derived(isFresh(item) ? item : undefined);
  const named = $derived(!fresh || NAME.test(fresh.name));
  const busy = $derived(page.client.busy);
</script>

{#if page.dirty(item)}
  <div class="bar" role="region" aria-label="Unsaved changes">
    <p class="what">
      {#if fresh}
        <strong>New {one}, not saved yet.</strong>
        {named ? "Saved to the Shared library, so any agent can use it." : `Name it to save it.`}
      {:else if reach}
        <strong>Unsaved changes.</strong> {reach} agents use this {one}; saving changes it for all of them.
      {:else}
        <strong>Unsaved changes.</strong>
      {/if}
    </p>
    <div class="acts">
      <button type="button" class="ui-button" data-variant="ghost" data-size="compact" disabled={busy} onclick={() => page.discard(item)}>Discard</button>
      {#if fresh}
        <button type="button" class="ui-button" data-variant="secondary" data-size="compact" disabled={busy || !named} onclick={() => void page.saveNew(fresh, "agent")}>Only {page.here}</button>
        <button type="button" class="ui-button" data-variant="primary" data-size="compact" disabled={busy || !named} onclick={() => void page.saveNew(fresh, "shared")}>Save to Shared</button>
      {:else if reach}
        <button type="button" class="ui-button" data-variant="secondary" data-size="compact" disabled={busy} onclick={() => void page.saveCopy(item)}>Save a copy for {page.here}</button>
        <button type="button" class="ui-button" data-variant="primary" data-size="compact" disabled={busy} onclick={() => void page.save(item)}>Save for all</button>
      {:else}
        <button type="button" class="ui-button" data-variant="primary" data-size="compact" disabled={busy} onclick={() => void page.save(item)}>Save</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .bar {
    position: sticky;
    bottom: 0.75rem;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.625rem 0.625rem 0.625rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
    box-shadow: var(--shadow-composer);
  }
  .what {
    flex: 1 1 10rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  strong {
    color: var(--foreground);
    font-weight: 600;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
</style>
