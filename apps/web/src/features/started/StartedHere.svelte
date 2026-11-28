<script lang="ts">
  /**
   * "Started here": everything this conversation started that is still open, of any kind. What has
   * answered, stopped or failed folds under "Finished". The list holds no message box: a row opens
   * the thing itself.
   */
  import type { SessionInfo } from "../../../../server/src/contract/protocol";
  import type { ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
  import Icon from "../../lib/ui/Icon.svelte";
  import { useNow } from "../../lib/clock.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import WorkRow from "./WorkRow.svelte";
  import { sourcesOf, startedBy } from "./work";

  let { owner, onschedule }: { owner: SessionInfo; onschedule: (schedule: ScheduleSummary) => void } = $props();
  const client = useSessions();
  // "working · 4m 05s" and "Running · 4 min" keep counting while something is open.
  const clock = useNow(() => works.some((work) => work.open && work.kind !== "schedule"));
  const works = $derived(startedBy(owner, sourcesOf(client), clock.now));
  const open = $derived(works.filter((work) => work.open));
  const finished = $derived(works.filter((work) => !work.open));
  let showFinished = $state(false);
</script>

{#if open.length}
  <ul class="list" aria-label="Started here">
    {#each open as work (work.key)}<li><WorkRow {work} {onschedule} /></li>{/each}
  </ul>
{:else if !finished.length}
  <p class="none">Nothing open. Sessions, processes and schedules this conversation starts show here.</p>
{/if}
{#if finished.length}
  <button type="button" class="fold" aria-expanded={showFinished} onclick={() => (showFinished = !showFinished)}>
    <Icon name={showFinished ? "chevronDown" : "chevronRight"} class="h-3.5 w-3.5" />Finished<span class="count">{finished.length}</span>
  </button>
  {#if showFinished}
    <ul class="list" aria-label="Finished">
      {#each finished as work (work.key)}<li><WorkRow {work} {onschedule} /></li>{/each}
    </ul>
  {/if}
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
  }
  .none {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    padding: 0.125rem 0 0.5rem;
  }
  .fold {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.25rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  @media (max-width: 599px) {
    .fold {
      min-height: 2.75rem;
    }
  }
  .fold:hover {
    color: var(--foreground);
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
</style>
