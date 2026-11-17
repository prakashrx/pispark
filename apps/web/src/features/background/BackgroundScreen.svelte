<script lang="ts">
  /**
   * Background (design language §6, set 5): the one view across everything that runs without you.
   * Pause all in the top bar; filters (All, Running, Scheduled, Failed); one card per owner (an app
   * or a session) that says who and where and opens it; and how many sessions may work at once.
   * Each thing is also managed with its owner, in that session's Details.
   */
  import Screen from "../../shell/Screen.svelte";
  import { layout } from "../../shell/layout.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Stepper from "../../lib/ui/Stepper.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import BackgroundGroup from "./BackgroundGroup.svelte";
  import { backgroundGroups, filterCounts, filterGroups, type BackgroundFilter } from "./background-groups";

  const client = useSessions();
  const schedules = client.schedules;
  let error = $state("");
  let filter = $state<BackgroundFilter>("all");
  $effect(() => {
    void schedules.refresh().catch(() => (error = "Couldn’t load the schedules."));
    void client.routines.refresh().catch(() => {});
    void client.processes.refresh().catch(() => {});
  });

  const groups = $derived(
    backgroundGroups({
      sessions: client.sessions,
      schedules: schedules.schedules,
      routines: client.routines.routines,
      processes: client.processes.running,
    }),
  );
  const shown = $derived(filterGroups(groups, filter));
  const counts = $derived(filterCounts(groups));
  const filters = $derived<[BackgroundFilter, string][]>([
    ["all", "All"],
    ["running", `Running ${counts.running}`],
    ["scheduled", `Scheduled ${counts.scheduled}`],
    ["failed", `Failed ${counts.failed}`],
  ]);

  async function pause(paused: boolean) {
    error = "";
    try {
      await client.saveSettings({ unattendedPaused: paused });
    } catch {
      error = "Couldn’t save. Try again.";
    }
    await schedules.refresh().catch(() => {});
    await client.refresh().catch(() => {});
  }
  async function atOnce(value: number) {
    error = "";
    try {
      await client.saveSettings({ maxRunning: value });
    } catch {
      error = "Couldn’t save. Try again.";
    }
  }
</script>

<Screen title="Background" wide={layout.size !== "compact"}>
  {#snippet actions()}
    <span class="pause">
      <span class="text-sm" aria-hidden="true">Pause all</span>
      <Toggle label="Pause all unattended runs" checked={schedules.paused} onchange={(event) => void pause((event.currentTarget as HTMLInputElement).checked)} />
    </span>
  {/snippet}
  <div class="page">
    {#if schedules.paused}<p class="paused" role="status">
        <Icon name="clock" class="mt-0.5 h-4 w-4 shrink-0" />Paused: schedules and routines don’t run, and sessions kept running are unloaded until you resume. Background tasks keep running.
      </p>{/if}
    {#if error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}

    <div class="filters" role="group" aria-label="Show">
      {#each filters as [id, label] (id)}
        <button type="button" class="filter" aria-pressed={filter === id} onclick={() => (filter = id)}>{label}</button>
      {/each}
    </div>

    {#if !schedules.loaded}<p role="status" class="empty">Loading…</p>
    {:else if shown.length}
      <div class="grid">
        {#each shown as group (group.key)}<BackgroundGroup {group} onerror={(message) => (error = message)} />{/each}
      </div>
    {:else}<p class="empty">
        {filter === "all"
          ? "Nothing runs in the background. Schedules, routines, background tasks and sessions kept running show here."
          : filter === "running"
            ? "Nothing is running."
            : filter === "scheduled"
              ? "No schedules or routines. Add a schedule from a session’s Details, or ask the agent."
              : "No failed runs."}
      </p>{/if}

    <div class="limits">
      <span class="grow">
        <span class="block text-sm">Sessions working at once</span>
        <span class="block text-xs text-muted-foreground">More wait their turn and start when one finishes.</span>
      </span>
      {#if client.settings}<Stepper label="Sessions working at once" value={client.settings.maxRunning} min={1} max={32} onchange={(value) => void atOnce(value)} />{/if}
    </div>
  </div>
</Screen>

<style>
  .page {
    max-width: 62rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .pause {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.5rem;
    color: var(--muted-foreground);
  }
  .paused {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    background: var(--muted);
    font-size: var(--text-sm);
  }
  .filters {
    display: flex;
    gap: 0.375rem;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .filter {
    flex-shrink: 0;
    min-height: 2rem;
    padding: 0 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
  }
  .filter:hover {
    background: var(--accent);
  }
  .filter[aria-pressed="true"] {
    background: var(--foreground);
    border-color: var(--foreground);
    color: var(--background);
  }
  :global([data-size="compact"]) .filter {
    min-height: 2.5rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 24rem), 1fr));
    gap: 0.75rem;
    align-items: start;
  }
  .empty {
    padding: 0.5rem 0;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .limits {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
</style>
