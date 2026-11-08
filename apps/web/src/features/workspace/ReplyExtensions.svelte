<script lang="ts">
  import ExtensionQuestion from "./ExtensionQuestion.svelte";
  import StyledText from "./StyledText.svelte";
  import { useSessions } from "./session-client.svelte";

  /**
   * What extensions show around the reply box, where terminal Pi shows it: widgets above and
   * below the editor, questions above it, statuses (or an extension's footer) underneath.
   */
  let { placement }: { placement: "above" | "below" } = $props();
  const client = useSessions();
  const view = $derived(client.snapshot?.extensions);
  const widgets = $derived(view?.widgets.filter((w) => w.placement === placement) ?? []);
</script>

{#if view}
  {#if widgets.length}
    <div class="extension-widgets" data-placement={placement}>
      {#each widgets as widget (widget.key)}<StyledText lines={widget.lines} />{/each}
    </div>
  {/if}
  {#if placement === "above"}
    {#if view.dialogs.length}
      <div class="extension-questions">
        {#each view.dialogs as dialog (dialog.id)}
          <ExtensionQuestion {dialog} onanswer={(value) => client.answer(dialog.id, value)} />
        {/each}
      </div>
    {/if}
  {:else if view.footer}
    <!-- An extension footer replaces the status line, as it replaces terminal Pi's footer. -->
    <div class="extension-statuses" aria-label="Extension status"><StyledText class="extension-status" lines={view.footer} /></div>
  {:else if view.statuses.length}
    <div class="extension-statuses" aria-label="Extension status">
      {#each view.statuses as status (status.key)}<StyledText class="extension-status" lines={[status.line]} />{/each}
    </div>
  {/if}
{/if}

<style>
  /* Quiet by default: widget text is secondary unless the extension colors it. */
  .extension-widgets {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0 0.5rem;
  }
  .extension-widgets :global(.styled-text) {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  /* Clear of the dock's fade, so the conversation never shows through it. */
  .extension-widgets[data-placement="above"] {
    padding-top: 1rem;
    margin-bottom: 0.625rem;
  }
  .extension-widgets[data-placement="below"] {
    margin-top: 0.5rem;
  }
  .extension-questions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 1rem;
    margin-bottom: 0.75rem;
  }
  .extension-statuses {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
    margin-top: 0.5rem;
    padding: 0 0.5rem;
    color: var(--muted-foreground);
  }
  .extension-statuses :global(.extension-status) {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
</style>
