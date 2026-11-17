<script lang="ts">
  import ExtensionQuestion from "./ExtensionQuestion.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import { useSession } from "./session-client.svelte";

  /**
   * The shelf above the composer (design language §1.7): small, live things that belong next to
   * typing, in a fixed order: questions waiting for an answer, then messages waiting their turn,
   * then extensions' components for this place (`session.input.above`).
   */
  const session = useSession();
  const view = $derived(session.doc?.extensions);
  const queued = $derived((session.doc?.queue.steering ?? 0) + (session.doc?.queue.followUp ?? 0));
</script>

{#if view?.dialogs.length}
  <div class="questions">
    {#each view.dialogs as dialog (dialog.id)}
      <ExtensionQuestion {dialog} onanswer={(value) => session.answer(dialog.id, value)} />
    {/each}
  </div>
{/if}
{#if queued > 0}<p role="status" class="queued">{queued} {queued === 1 ? "message" : "messages"} queued</p>{/if}
{#if view}<ContributionPoint point="session.input.above" />{/if}

<style>
  .questions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 60dvh;
    overflow-y: auto;
    margin-bottom: 0.5rem;
  }
  .queued {
    margin: 0 0 0.375rem 0.5rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
</style>
