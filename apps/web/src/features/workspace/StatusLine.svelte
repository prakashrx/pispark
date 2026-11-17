<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import { details } from "./details.svelte";
  import { useSession, useSessions } from "./session-client.svelte";
  import { modelName } from "./session-presentation";

  /**
   * The status line under the composer (design language §1.8): PiSpark's own readout of the
   * model first, which opens Details, then extensions' components (`session.status`). A component place, not a text
   * line: Pi's terminal-style statuses and footers are not shown.
   */
  const client = useSessions();
  const session = useSession();
  const model = $derived(modelName(client.providers.catalog.providers, session.doc?.model));
</script>

<div class="status-line">
  {#if model}<button type="button" class="readout" title="Model · open Details" onclick={() => details.show(session.id)}
      ><Icon name="model" class="h-3.5 w-3.5" /><span class="sr-only">Model:</span> {model}</button
    >{/if}
  {#if session.doc}<ContributionPoint point="session.status" />{/if}
</div>

<style>
  .status-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    min-height: 1.5rem;
    padding: 0.25rem 0.5rem 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .status-line:empty {
    display: none;
  }
  .readout {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 1.5rem;
    margin-left: -0.375rem;
    padding: 0 0.375rem;
    border-radius: var(--radius-sm);
  }
  .readout:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  /* The keyboard needs the room while typing on a phone. */
  @media (max-width: 599.98px) {
    :global(.dock:has([role="textbox"]:focus)) .status-line {
      display: none;
    }
  }
</style>
