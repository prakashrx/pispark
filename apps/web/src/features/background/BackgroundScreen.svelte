<script lang="ts">
  /**
   * Background (design language §6): what runs without you, across all of PiSpark, that is not
   * itself a conversation. One flat list in two groups, Running and Scheduled, drawn with the same
   * row as a conversation's "Started here"; each row names whom it belongs to and opens it.
   * Sessions are not rows here: the session list already marks the ones that need you, are working
   * or failed. Pause all sits in the top bar; at the foot, how many sessions may work at once.
   */
  import Popover from "../../lib/ui/Popover.svelte";
  import Screen from "../../shell/Screen.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Stepper from "../../lib/ui/Stepper.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import { shortDate } from "../../../../server/src/contract/cron";
  import type { Routine, ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
  import { href } from "../../routes";
  import ScheduleDialog from "../schedules/ScheduleDialog.svelte";
  import WorkRow from "../started/WorkRow.svelte";
  import { everywhere, sourcesOf, type Work } from "../started/work";
  import { useNow } from "../workspace/clock.svelte";
  import { useSessions } from "../workspace/session-client.svelte";

  type Filter = "all" | "running" | "scheduled" | "failed";
  const client = useSessions();
  const schedules = client.schedules;
  let error = $state("");
  let filter = $state<Filter>("all");
  $effect(() => {
    void schedules.refresh().catch(() => (error = "Couldn’t load the schedules."));
    void client.routines.refresh().catch(() => {});
    void client.processes.refresh().catch(() => {});
  });

  // "Running · 4 min" keeps counting while something runs.
  const clock = useNow(() => works.some((work) => work.kind === "process"));
  const works = $derived(everywhere(sourcesOf(client), clock.now));
  /** A process, or keeping a session loaded: something running now. The rest runs at its times. */
  const running = (work: Work) => work.kind === "process" || work.kind === "kept";
  const counts = $derived({
    running: works.filter(running).length,
    scheduled: works.filter((work) => !running(work)).length,
    failed: works.filter((work) => work.failed).length,
  });
  const filters = $derived<[Filter, string][]>([
    ["all", "All"],
    ["running", `Running ${counts.running}`],
    ["scheduled", `Scheduled ${counts.scheduled}`],
    ["failed", `Failed ${counts.failed}`],
  ]);
  const groups = $derived(
    [
      { label: "Running", rows: filter === "all" || filter === "running" ? works.filter(running) : [] },
      { label: "Scheduled", rows: works.filter((work) => !running(work) && (filter === "all" || filter === "scheduled" || (filter === "failed" && work.failed))) },
    ].filter((group) => group.rows.length),
  );
  /** The schedule open in its form, and the routine whose prompt and runs show under its row. */
  let editing = $state<ScheduleSummary>();
  let unfolded = $state<string>();

  async function act(work: () => Promise<unknown>, failed = "Couldn’t save. Try again.") {
    error = "";
    try {
      await work();
    } catch {
      error = failed;
    }
  }
  async function pause(paused: boolean) {
    await act(() => client.saveSettings({ unattendedPaused: paused }));
    await schedules.refresh().catch(() => {});
    await client.refresh().catch(() => {});
  }
  const runNow = (routine: Routine) => act(() => client.routines.run(routine).then(() => client.refresh()), "Couldn’t run it. Try again.");
</script>

<Screen title="Background">
  {#snippet actions()}
    <span class="pause">
      <span class="text-sm" aria-hidden="true">Pause all</span>
      <Toggle label="Pause all unattended runs" checked={schedules.paused} onchange={(event) => void pause((event.currentTarget as HTMLInputElement).checked)} />
    </span>
  {/snippet}
  <div class="page">
    {#if schedules.paused}<p class="paused" role="status">
        <Icon name="clock" class="mt-0.5 h-4 w-4 shrink-0" />Paused: schedules and routines don’t run, and sessions kept running are unloaded until you resume. Processes keep running.
      </p>{/if}
    {#if error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}

    <div class="filter-row">
      <div class="filters" role="group" aria-label="Show">
        {#each filters as [id, label] (id)}
          <button type="button" class="filter" aria-pressed={filter === id} onclick={() => (filter = id)}>{label}</button>
        {/each}
      </div>
      <!-- What each kind is (B-08): one line each, on demand. -->
      <Popover label="What runs here">
        {#snippet trigger()}<Icon name="help" class="h-4 w-4" />{/snippet}
        {#snippet children()}
          <dl class="explain">
            <dt>Processes</dt>
            <dd>Commands a session started that keep running, such as a dev server. They end with PiSpark.</dd>
            <dt>Kept running</dt>
            <dd>A session an extension keeps loaded while no one watches, because its agent allows it.</dd>
            <dt>Schedules</dt>
            <dd>A prompt sent to a session at set times, in that session or a new one each time.</dd>
            <dt>Routines</dt>
            <dd>An agent’s own schedules: off until you switch them on; each run is a new session.</dd>
          </dl>
        {/snippet}
      </Popover>
    </div>

    {#if !schedules.loaded}<p role="status" class="empty">Loading…</p>
    {:else}
      {#each groups as group (group.label)}
        <section aria-label={group.label}>
          <h2 class="label">{group.label}</h2>
          <ul>
            {#each group.rows as work (work.key)}
              <li>
                <WorkRow {work} named expanded={unfolded === work.key} onschedule={(schedule) => (editing = schedule)} onroutine={() => (unfolded = unfolded === work.key ? undefined : work.key)} />
                {#if work.routine && unfolded === work.key}
                  {@const routine = work.routine}
                  <div class="more">
                    <p class="prompt">{routine.prompt}</p>
                    {#if routine.runs.length}<p class="runs">
                        Recent runs:
                        {#each routine.runs.slice(0, 3) as run, index (run.session)}{index ? " · " : " "}{#if client.sessions.some((s) => s.id === run.session)}<a
                              class="link"
                              href={href({ name: "session", id: run.session })}>{shortDate(new Date(run.due))}</a
                            >{:else}{shortDate(new Date(run.due))}{run.archived ? " (archived)" : ""}{/if}{/each}
                      </p>{/if}
                    <Button size="compact" onclick={() => void runNow(routine)}>Run now</Button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {:else}
        <p class="empty">
          {filter === "all"
            ? "Nothing runs in the background. Processes, schedules, routines and sessions kept running show here."
            : filter === "running"
              ? "Nothing is running."
              : filter === "scheduled"
                ? "No schedules or routines. Add a schedule from a session’s Details, or ask the agent."
                : "No failed runs."}
        </p>
      {/each}
    {/if}

    <div class="limits">
      <span class="grow">
        <span class="block text-sm">Sessions working at once</span>
        <span class="block text-xs text-muted-foreground">More wait their turn and start when one finishes.</span>
      </span>
      {#if client.settings}<Stepper label="Sessions working at once" value={client.settings.maxRunning} min={1} max={32} onchange={(value) => void act(() => client.saveSettings({ maxRunning: value }))} />{/if}
    </div>
  </div>
</Screen>

{#if editing}<ScheduleDialog sessionId={editing.sessionId} schedule={editing} onclose={() => (editing = undefined)} />{/if}

<style>
  .page {
    max-width: 44rem;
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
  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .filter-row .filters {
    flex: 1;
    min-width: 0;
  }
  .explain {
    display: grid;
    gap: 0.25rem 0;
    width: min(22rem, 80vw);
    padding: 0.75rem;
    font-size: var(--text-sm);
  }
  .explain dt {
    font-weight: 600;
  }
  .explain dd {
    margin-bottom: 0.375rem;
    color: var(--muted-foreground);
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
  .label {
    padding: 0.5rem 0 0.125rem;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--muted-foreground);
  }
  /* A routine unfolded under its row: what it sends, its last runs, and Run now. */
  .more {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.375rem;
    padding: 0.125rem 0 0.625rem 1.75rem;
    font-size: var(--text-sm);
  }
  .prompt {
    white-space: pre-wrap;
  }
  .runs {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
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
