<script lang="ts">
  import SettingsPage from "../../lib/ui/SettingsPage.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import FieldRow from "../../lib/ui/FieldRow.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { describeSchedule, shortDate } from "../../../../server/src/contract/cron";
  import { useSessions } from "../workspace/session-client.svelte";
  import { sessionName } from "../workspace/session-presentation";
  import { processName, processState } from "../background/process-presentation";
  import { showProcess } from "../background/background-client.svelte";
  import ScheduleCard from "./ScheduleCard.svelte";
  /**
   * Settings → Background: the one place that shows everything that runs without you (schedules,
   * app routines, sessions kept running, processes), and Pause all.
   */
  const client = useSessions();
  const schedules = client.schedules;
  let error = $state("");
  $effect(() => {
    void schedules.refresh().catch(() => (error = "Couldn’t load the schedules."));
    void client.routines.refresh().catch(() => {});
    void client.processes.refresh().catch(() => {});
  });
  const held = $derived(client.sessions.filter((session) => session.held));
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
  async function act(work: () => Promise<unknown>) {
    error = "";
    try {
      await work();
    } catch (failure) {
      error = (failure as Error).message;
    }
  }
  function open(id: string) {
    void client.select(id);
    window.location.hash = "/workspace";
  }
  const titleOf = (id: string, fallback?: string) => {
    const listed = client.sessions.find((session) => session.id === id);
    return listed ? sessionName(listed) : (fallback ?? "A chat");
  };
</script>

<SettingsPage
  title="Background"
  description="Everything that runs without you: schedules, app routines, sessions kept running, and processes. Each run is an ordinary session you can open."
  label="Background settings"
>
  <Section
    title="Pause all"
    description="While paused, nothing runs unless you ask: schedules and routines record their runs as missed, and sessions kept running are unloaded until you resume. Processes keep running."
  >
    <div class="settings-card mt-4">
      <FieldRow label="Pause all unattended runs" description={schedules.paused ? "Paused: nothing runs unless you ask." : "Schedules and routines run at their times."}>
        <Toggle
          label="Pause all unattended runs"
          checked={schedules.paused}
          onchange={(event) => void pause((event.currentTarget as HTMLInputElement).checked)}
        />
      </FieldRow>
    </div>
  </Section>
  {#if error}<p role="alert" class="mt-4 text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
  <Section title="Schedules" description="Add one from a chat’s info (Chat info → Schedules), or ask the agent in a chat.">
    {#if schedules.schedules.length}
      <ul class="mt-4 space-y-3" aria-label="All schedules">
        {#each schedules.schedules as schedule (schedule.id)}<ScheduleCard {schedule} withSession />{/each}
      </ul>
    {:else if schedules.loaded}<p class="mt-4 text-sm text-muted-foreground">No schedules yet.</p>
    {:else}<p role="status" class="mt-4 text-sm text-muted-foreground">Loading…</p>{/if}
  </Section>
  {#if client.routines.routines.length}
    <Section title="App routines" description="Routines your personas offer. Each is off until you switch it on; each run is a new session of the persona.">
      <ul class="mt-4 space-y-3" aria-label="All routines">
        {#each client.routines.routines as routine (routine.persona.id + routine.id)}
          <li class="card">
            <div class="flex flex-wrap items-start gap-3">
              <div class="pt-0.5">
                <Toggle
                  label={`Run ${routine.name}`}
                  checked={routine.on}
                  onchange={(event) => void act(() => client.routines.set(routine, (event.currentTarget as HTMLInputElement).checked))}
                />
              </div>
              <div class="min-w-0" style="flex: 1 1 12rem">
                <p class="text-sm font-medium">{routine.name}</p>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {describeSchedule({ cron: routine.cron })} · {!routine.on ? "Off" : schedules.paused ? "Paused" : routine.next ? `Next ${shortDate(new Date(routine.next))}` : "On"}
                </p>
                <p class="mt-1.5 text-[0.8125rem] text-muted-foreground">{routine.persona.name}</p>
              </div>
              <div class="ml-auto flex shrink-0 gap-1">
                <Button size="compact" onclick={() => void act(() => client.routines.run(routine).then(() => client.refresh()))}>Run now</Button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </Section>
  {/if}
  <Section title="Kept running" description="Sessions an extension keeps loaded so it can listen or work while no one watches. Allowed per persona.">
    {#if held.length}
      <ul class="mt-4 space-y-3" aria-label="Sessions kept running">
        {#each held as session (session.id)}
          <li class="card flex flex-wrap items-start gap-3">
            <Icon name="pin" class="mt-0.5 h-4 w-4 shrink-0 text-[var(--interactive-text)]" />
            <div class="min-w-0" style="flex: 1 1 12rem">
              <p class="text-sm font-medium">{session.held!.extension}: {session.held!.reason}</p>
              <p class="mt-1.5 text-[0.8125rem]">
                <button type="button" class="link" onclick={() => open(session.id)}>{sessionName(session)}</button>
                <span class="text-muted-foreground">· {session.persona.name}</span>
              </p>
            </div>
            <Button size="compact" onclick={() => void client.hold(session.id, "release-hold")}>Release</Button>
          </li>
        {/each}
      </ul>
    {:else}<p class="mt-4 text-sm text-muted-foreground">None. An extension asks when it needs to keep running.</p>{/if}
  </Section>
  <Section title="Processes" description="Commands sessions started that are still running. PiSpark stopping ends them.">
    {#if client.processes.running.length}
      <ul class="mt-4 space-y-3" aria-label="Running processes">
        {#each client.processes.running as process (process.id)}
          <li class="card flex flex-wrap items-start gap-3">
            <Icon name="terminal" class="mt-0.5 h-4 w-4 shrink-0 text-[var(--interactive-text)]" />
            <div class="min-w-0" style="flex: 1 1 12rem">
              <p class="text-sm font-medium">{processName(process)}</p>
              <p class="mt-0.5 text-xs text-muted-foreground">{processState(process)} · {process.folder}</p>
              <p class="mt-1.5 text-[0.8125rem]">
                <button type="button" class="link" onclick={() => open(process.sessionId)}>{titleOf(process.sessionId, process.session.title)}</button>
              </p>
            </div>
            <div class="ml-auto flex shrink-0 gap-1">
              <Button
                size="compact"
                variant="ghost"
                onclick={() => {
                  showProcess(process.sessionId, process.id);
                  open(process.sessionId);
                }}>Show output</Button
              >
              <Button size="compact" onclick={() => void act(() => client.processes.stop(process.sessionId, process.id))}>Stop</Button>
            </div>
          </li>
        {/each}
      </ul>
    {:else}<p class="mt-4 text-sm text-muted-foreground">None running.</p>{/if}
  </Section>
</SettingsPage>

<style>
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.875rem 1rem;
    list-style: none;
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
