<script lang="ts">
  import StatusMark from "../../lib/ui/StatusMark.svelte";
  import { useNow } from "./clock.svelte";
  import { elapsed } from "./session-presentation";
  import type { Turn } from "./session-turns";
  /**
   * How long a turn has run, where its reply ends (decision C-23): "Working · 12s" while it runs,
   * "Worked 1m 42s" once done. Nothing when the session has no times for it.
   */
  let { turn }: { turn: Turn } = $props();
  const clock = useNow(() => turn.running);
  const took = $derived(turn.startedAt && turn.endedAt && turn.endedAt > turn.startedAt ? turn.endedAt - turn.startedAt : undefined);
</script>

{#if turn.running && turn.startedAt}
  <p class="turn-time"><StatusMark kind="busy" label="Working" words detail={`· ${elapsed(clock.now - turn.startedAt)}`} /></p>
{:else if !turn.running && took !== undefined && took >= 1000}
  <p class="turn-time">Worked {elapsed(took)}</p>
{/if}

<style>
  .turn-time {
    margin-top: -0.25rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
