<script lang="ts">
  import StatusMark from "../../lib/ui/StatusMark.svelte";
  import { useNow } from "./clock.svelte";
  import { elapsed } from "./session-presentation";
  import { useSession } from "./session-client.svelte";
  import type { Turn } from "./session-turns";
  /**
   * How long a turn has run, where its reply ends (decision C-23): "Working · 12s" while it runs,
   * "Worked 1m 42s" once done. While Pi retries a failed reply, it says that instead, and when.
   * Nothing when the session has no times for it.
   */
  let { turn }: { turn: Turn } = $props();
  const session = useSession();
  const clock = useNow(() => turn.running);
  const took = $derived(turn.startedAt && turn.endedAt && turn.endedAt > turn.startedAt ? turn.endedAt - turn.startedAt : undefined);
  const retrying = $derived(turn.running ? session?.doc?.retrying : undefined);
  const why = $derived(
    retrying
      ? { "usage-limit": "Usage limit", unavailable: "Provider busy", "context-full": "Too long", "signed-out": "Sign-in refused", failed: "Reply failed" }[retrying.failure]
      : "",
  );
  const wait = $derived(retrying ? Math.max(0, Math.ceil((Date.parse(retrying.at) - clock.now) / 1000)) : 0);
</script>

{#if retrying}
  <p class="turn-time" role="status">
    <StatusMark kind="busy" label={`${why}, retrying`} words detail={`· ${retrying.attempt} of ${retrying.of}${wait ? ` in ${wait}s` : ""}`} />
  </p>
{:else if turn.running && turn.startedAt}
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
