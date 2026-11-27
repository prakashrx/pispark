<script lang="ts">
  /**
   * The strip above the message box: what this conversation has going, in one line. It is there
   * only when something is open and "Started here" is not already on screen, and it opens it: the
   * side panel where it fits, the Details screen on a phone.
   */
  import type { SessionInfo } from "../../../../server/src/contract/protocol";
  import Icon from "../../lib/ui/Icon.svelte";
  import { details } from "../workspace/details.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import { sourcesOf, startedBy, summary } from "./work";

  let { owner }: { owner: SessionInfo } = $props();
  const client = useSessions();
  const open = $derived(startedBy(owner, sourcesOf(client), Date.now()).filter((work) => work.open));
  const busy = $derived(open.some((work) => work.state === "working" || work.kind === "process"));
  const shown = $derived(open.length > 0 && details.view(owner.id) !== "details");
</script>

{#if shown}
  <button type="button" class="strip" data-purpose="activity-strip" aria-label={`Started here: ${summary(open)}`} onclick={() => details.show(owner.id)}>
    {#if busy}<span class="spin" aria-hidden="true"></span>{:else}<Icon name="clock" class="h-3.5 w-3.5" />{/if}
    <span class="words">{summary(open)}</span>
    <Icon name="chevronRight" class="h-3.5 w-3.5" />
  </button>
{/if}

<style>
  .strip {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 100%;
    min-height: 2rem;
    margin-bottom: 0.375rem;
    padding: 0 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--background);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  @media (max-width: 599px) {
    .strip {
      min-height: 2.5rem;
    }
  }
  .strip:hover {
    color: var(--foreground);
    background: var(--muted);
  }
  .words {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--foreground);
  }
  .spin {
    width: 0.75rem;
    height: 0.75rem;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    border: 2px solid var(--border);
    border-top-color: var(--interactive);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
      border-style: dotted;
    }
  }
</style>
