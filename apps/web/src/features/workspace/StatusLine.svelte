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
  // How full the model's context is (design set 3/4: "GPT-5.6 · 38%").
  const context = $derived(session.doc?.context);
  /** The filled part of the little context pie (design set 3/4: "◔ 38%"). */
  function pie(percent: number): string {
    const p = Math.min(99.9, Math.max(0, percent)) / 100;
    if (p <= 0) return "";
    const angle = p * 2 * Math.PI;
    const x = 8 + 4.5 * Math.sin(angle);
    const y = 8 - 4.5 * Math.cos(angle);
    return `M8 8 L8 3.5 A4.5 4.5 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
  }
</script>

<div class="status-line">
  {#if model}<button type="button" class="readout" title="Model · open Details" onclick={() => details.show(session.id)}
      ><Icon name="model" class="h-3.5 w-3.5" /><span class="sr-only">Model:</span>
      {model}{#if context?.percent != null}<span class="context"
          ><span aria-hidden="true"> · </span><svg class="pie" viewBox="0 0 16 16" aria-hidden="true"
            ><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path
              d={pie(context.percent)}
              fill="currentColor"
            /></svg
          ><span class="sr-only">, context</span>{` ${Math.round(context.percent)}%`}</span
        >{/if}</button
    >{/if}
  {#if session.doc}<ContributionPoint point="session.status" />{/if}
</div>

<style>
  .context {
    display: inline-flex;
    align-items: center;
    gap: 0.1875rem;
  }
  .pie {
    width: 0.75rem;
    height: 0.75rem;
  }
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
