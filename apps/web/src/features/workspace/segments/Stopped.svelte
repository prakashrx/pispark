<script lang="ts">
  import type { Segment } from "../session-turns";

  /** Where a reply ended early: cancelled, or failed (design set 8/4: a card in the conversation, where it happened). */
  let { segment }: { segment: Extract<Segment, { kind: "stopped" }> } = $props();
</script>

{#if segment.reason === "aborted"}
  <p class="text-sm text-subtle italic">Cancelled</p>
{:else}
  <p role="alert" class="failed">The run failed: the model couldn’t finish. Check the provider or choose another model.</p>
{/if}

<style>
  .failed {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-strong, var(--border));
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--foreground);
  }
</style>
