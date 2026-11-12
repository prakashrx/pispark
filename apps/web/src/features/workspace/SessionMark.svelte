<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  // A session's state beside its name in the sidebar. The shape carries the meaning (spinner, alert,
  // question, clock) and the words are announced; colour only reinforces it.
  let { status }: { status: string } = $props();
</script>

{#if status}
  <span
    class="session-mark"
    data-tone={status === "Needs attention" ? "warning" : "active"}
    title={status}
  >
    {#if status === "Needs attention"}<Icon name="alert" class="h-4 w-4" />{:else if status === "Waiting for you"}<Icon
        name="help"
        class="h-4 w-4"
      />{:else if status === "Queued"}<Icon name="clock" class="h-4 w-4" />{:else}<span
        class="session-spinner"
        aria-hidden="true"
      ></span>{/if}
    <span class="sr-only">{status}</span>
  </span>
{/if}

<style>
  .session-mark {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    color: var(--interactive-text);
  }
  .session-mark[data-tone="warning"] {
    color: var(--warning-foreground);
  }
  .session-spinner {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
    border-top-color: currentColor;
    animation: session-spin 0.9s linear infinite;
  }
  @keyframes session-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .session-spinner {
      animation: none;
      border-color: currentColor;
      width: 0.5rem;
      height: 0.5rem;
    }
  }
</style>
