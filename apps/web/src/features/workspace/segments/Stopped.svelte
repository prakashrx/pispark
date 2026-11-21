<script lang="ts">
  import type { Segment } from "../session-turns";
  import Button from "../../../lib/ui/Button.svelte";
  import { details } from "../details.svelte";
  import { useSession } from "../session-client.svelte";
  const session = useSession();
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

  /** Where a reply ended early: cancelled, or failed (design set 8/4: a card in the conversation, where it happened). */
  let { segment }: { segment: Extract<Segment, { kind: "stopped" }> } = $props();
</script>

{#if segment.reason === "aborted"}
  <p class="text-sm text-subtle italic">Cancelled</p>
{:else if segment.reason === "usage-limit"}
  <div role="alert" class="failed">
    <p>OpenAI reported a usage limit for this connection. Check your ChatGPT usage and connected app limits.</p>
    <a class="ui-button" href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noopener noreferrer">Check usage</a>
  </div>
{:else}
  <div role="alert" class="failed">
    <p>The run failed: the model couldn’t finish. Check the provider or choose another model.</p>
    {#if !session.doc?.readOnly}<Button size="compact" onclick={chooseModel}>Choose another model</Button>{/if}
  </div>
{/if}

<style>
  .failed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-strong, var(--border));
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--foreground);
  }
</style>
