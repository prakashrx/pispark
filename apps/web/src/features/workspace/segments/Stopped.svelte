<script lang="ts">
  import type { Segment } from "../chat-turns";

  let { segment }: { segment: Extract<Segment, { kind: "stopped" }> } = $props();
</script>

{#if segment.reason === "aborted"}
  <p class="text-sm text-subtle italic">Cancelled</p>
{:else}
  <p role="alert" class="text-sm px-4 py-3 rounded-xl bg-[var(--danger-muted)] text-[var(--danger-foreground)]">
    Model execution failed. Check account and model access, or choose another model for a new session.
  </p>
{/if}
