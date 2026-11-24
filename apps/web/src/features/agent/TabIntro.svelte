<script lang="ts">
  /**
   * The top of every resource tab: one line on how Pi uses the kind, then the two ways to get
   * something new, kept apart. Add picks from what's available (bundled with PiSpark, the Shared
   * library, this agent's own files) with a search dropdown; Create starts a new one here.
   */
  import type { Snippet } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import type { AvailableResource } from "../../../../server/src/contract/agent-protocol";
  import { KINDS, type AgentPage, type Kind } from "./agent-page.svelte";

  let { page, kind, oncreate, createLabel = "Create", children }: { page: AgentPage; kind: Kind; oncreate?: () => void; createLabel?: string; children: Snippet } = $props();

  let available = $state<AvailableResource[]>([]);
  let loading = $state(true);
  let error = $state("");
  let chosen = $state("");
  async function refresh() {
    loading = true;
    try {
      available = (await page.client.availableResources(kind)).resources;
      error = "";
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void page.view?.revision;
    void refresh();
  });
  const present = $derived(new Set((page.view?.items ?? []).filter((item) => item.type === kind && item.origin.id === page.agent).map((item) => item.name)));
  const from = (reference: string) => (reference.startsWith("bundled:") ? "Bundled" : reference.startsWith("shared:") ? "Shared" : "This agent's folder");
  const options = $derived(
    available
      .filter((entry) => !present.has(entry.name))
      .map((entry) => ({ value: entry.reference, label: `${kind === "prompts" ? "/" : ""}${entry.name} · ${from(entry.reference)}${entry.usedBy ? ` · ${entry.usedBy} ${entry.usedBy === 1 ? "agent" : "agents"}` : ""}` })),
  );
  $effect(() => {
    if (!chosen) return;
    const reference = chosen;
    chosen = "";
    void page.client.selectResource(kind, reference as AvailableResource["reference"], true);
  });
</script>

<div class="intro">
  <p class="lead">{@render children()}</p>
  {#if !page.readOnly}
    <div class="actions">
      <Selector label={`Add ${KINDS[kind].one}`} options={options} bind:value={chosen} searchable action {loading} error={error || undefined} emptyText={`Nothing else to add. Create one, or put one in the Shared library.`} disabled={page.client.busy}>
        {#snippet children()}<Icon name="plus" class="h-4 w-4" /><span>Add</span>{/snippet}
      </Selector>
      {#if oncreate}<button type="button" class="ui-button create" data-variant="primary" data-size="compact" onclick={oncreate}><Icon name="plus" class="h-4 w-4" />{createLabel}</button>{/if}
    </div>
  {/if}
</div>

<style>
  .intro {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
    margin-bottom: 1rem;
  }
  .lead {
    flex: 1 1 18rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .lead :global(em) {
    font-style: normal;
    font-weight: 600;
    color: var(--foreground);
  }
  .lead :global(kbd),
  .lead :global(code) {
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: 0 0.3rem;
    border-radius: var(--radius-sm);
    background: var(--muted);
    color: var(--foreground);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .create {
    border-radius: var(--radius-full);
  }
</style>
