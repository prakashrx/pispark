<script lang="ts">
  import type { Segment } from "../session-turns";
  import Button from "../../../lib/ui/Button.svelte";
  import { details } from "../details.svelte";
  import { useSession, useSessions } from "../session-client.svelte";

  /**
   * Where a reply ended early (design set 8/4: a card in the conversation, where it happened):
   * cancelled, or failed and why, in plain words with the provider's own under Details. On the
   * session's last reply the card offers Retry and the remedy that fits.
   */
  let { segment }: { segment: Extract<Segment, { kind: "stopped" }> } = $props();
  const session = useSession();
  const client = useSessions();

  const provider = $derived(
    (segment.provider && client.providers.catalog.providers.find((each) => each.id === segment.provider)?.name) || "The provider",
  );
  const said = $derived(
    {
      aborted: "",
      "usage-limit": `${provider} reported a usage limit for this connection.`,
      unavailable: `${provider} was overloaded or out of reach, and retrying didn’t help.`,
      "context-full": "The conversation is too long for this model.",
      "signed-out": `${provider} didn’t accept the sign-in.`,
      failed: "The model couldn’t finish this reply.",
    }[segment.reason],
  );
  const chatgpt = $derived(segment.provider === "openai" || segment.provider === "openai-codex");
  // Remedies act on the session as it is now: only on its last reply, and only between replies.
  const free = $derived(!session.doc?.readOnly && (session.doc?.status === "idle" || session.doc?.status === "error"));
  const acting = $derived(segment.latest && free);

  // The remedy is right there: Details opens on the model, between replies.
  function chooseModel() {
    details.show(session.id);
    // Focus goes to the model, not to the panel's heading.
    details.wantsFocus = false;
    const focus = (tries: number) => {
      const picker = document.querySelector<HTMLElement>("[data-model-picker] button, [data-model-picker] select");
      if (picker) picker.focus();
      else if (tries) setTimeout(() => focus(tries - 1), 50);
    };
    focus(20);
  }
  let compacting = $state(false);
  async function compact() {
    compacting = true;
    try {
      await session.compact();
    } catch {
      // The session's own notice says why.
    } finally {
      compacting = false;
    }
  }
</script>

{#if segment.reason === "aborted"}
  <p class="text-sm text-subtle italic">Cancelled</p>
{:else}
  <div role="alert" class="failed">
    <p class="said">{said}</p>
    {#if acting}<div class="actions">
        <Button size="compact" variant="primary" onclick={() => void session.send("Retry")}>Retry</Button>
        {#if segment.reason === "context-full"}<Button size="compact" loading={compacting} onclick={() => void compact()}>Compact context</Button>{/if}
        {#if segment.reason === "signed-out"}<a class="ui-button" data-size="compact" href="#/settings/providers">Providers &amp; models</a>{/if}
        {#if segment.reason === "usage-limit" && chatgpt}<a class="ui-button" data-size="compact" href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noopener noreferrer"
            >Check usage</a
          >{/if}
        <Button size="compact" variant="ghost" onclick={chooseModel}>Choose another model</Button>
      </div>{/if}
    {#if segment.error}<details class="detail">
        <summary>Details</summary>
        <p>{segment.error}</p>
      </details>{/if}
  </div>
{/if}

<style>
  .failed {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--border-strong, var(--border));
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--foreground);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .detail summary {
    width: fit-content;
    cursor: pointer;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .detail p {
    margin-top: 0.375rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    overflow-wrap: anywhere;
  }
</style>
