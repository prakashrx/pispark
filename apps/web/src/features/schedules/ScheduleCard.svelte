<script lang="ts">
  import { tick } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import { describeSchedule, shortDate } from "../../../../server/src/contract/cron";
  import type { ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
  import { useSessions } from "../workspace/session-client.svelte";
  import { sessionName } from "../workspace/session-presentation";
  import ScheduleForm from "./ScheduleForm.svelte";
  import { nextText, runFailed, runText } from "./schedule-presentation";
  /**
   * One schedule: when, what, on or off, Run now, change and delete, and what its runs did. On the
   * Schedules page it names its chat (`withSession`) and shows only its last run.
   */
  let { schedule, withSession = false }: { schedule: ScheduleSummary; withSession?: boolean } = $props();
  const client = useSessions();
  const schedules = client.schedules;
  let editing = $state(false);
  let confirming = $state(false);
  let error = $state("");
  let running = $state(false);
  let card = $state<HTMLElement>();
  const when = $derived(describeSchedule(schedule));
  const runs = $derived(withSession ? schedule.runs.slice(0, 1) : schedule.runs);
  const chat = $derived.by(() => {
    const listed = client.sessions.find((session) => session.id === schedule.sessionId);
    return listed ? sessionName(listed) : (schedule.session.title ?? schedule.session.persona.name);
  });

  async function act(work: () => Promise<unknown>) {
    error = "";
    try {
      await work();
      return true;
    } catch (failure) {
      error = (failure as Error).message;
      return false;
    }
  }
  async function runNow() {
    running = true;
    await act(() => schedules.run(schedule.id));
    running = false;
  }
  async function stopEditing() {
    editing = false;
    await tick();
    card?.querySelector<HTMLElement>("[data-edit]")?.focus();
  }
  async function ask() {
    confirming = true;
    await tick();
    card?.querySelector<HTMLElement>("[data-cancel]")?.focus();
  }
  async function cancel() {
    confirming = false;
    await tick();
    card?.querySelector<HTMLElement>("[data-delete]")?.focus();
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    void cancel();
  };
  function openChat() {
    void client.select(schedule.sessionId);
    window.location.hash = "/workspace";
  }
</script>

<li class="schedule-card" bind:this={card}>
  {#if editing}
    <ScheduleForm
      {schedule}
      oncancel={() => void stopEditing()}
      onsave={async (input) => {
        await schedules.update(schedule.id, input);
        await stopEditing();
      }}
    />
  {:else}
    <div class="flex flex-wrap items-start gap-3">
      <div class="pt-0.5">
        <Toggle
          label={`Run ${when}`}
          checked={schedule.on}
          disabled={!!schedule.held}
          onchange={(event) => void act(() => schedules.update(schedule.id, { on: (event.currentTarget as HTMLInputElement).checked }))}
        />
      </div>
      <div class="min-w-0" style="flex: 1 1 12rem">
        <p class="text-sm font-medium">{when}</p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {nextText(schedule, schedules.paused)}{schedule.by === "agent" ? " · Added by the agent after you said yes" : ""}
        </p>
        <p class="text-sm mt-2 whitespace-pre-wrap break-words">{schedule.prompt}</p>
        {#if withSession}<p class="text-[0.8125rem] mt-1.5">
            <button type="button" class="link" onclick={openChat}>{chat}</button>
            <span class="text-muted-foreground">· {schedule.session.persona.name}</span>
          </p>{/if}
      </div>
      <div class="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
        <Button
          size="compact"
          loading={running}
          unavailable={schedule.held ? "Restore the chat first" : undefined}
          onclick={() => void runNow()}>Run now</Button
        >
        <Button size="compact" variant="ghost" data-edit onclick={() => (editing = true)}>Edit</Button>
        <Button size="compact" variant="ghost" data-delete onclick={() => void ask()}>Delete</Button>
      </div>
    </div>
    {#if confirming}
      <div class="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Delete this schedule">
        <p class="text-sm flex-1">Delete this schedule? Its runs stay in the chat.</p>
        <Button size="compact" variant="destructive" onkeydown={escape} onclick={() => void act(() => schedules.remove(schedule.id))}>Delete</Button>
        <Button size="compact" data-cancel onkeydown={escape} onclick={() => void cancel()}>Cancel</Button>
      </div>
    {/if}
    {#if error}<p role="alert" class="mt-2 text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
    <div class="runs">
      {#if runs.length}
        <h4 class="text-xs font-medium text-subtle mb-1.5">{withSession ? "Last run" : "Last runs"}</h4>
        <dl class="run-list">
          {#each runs as run (run.at + run.due)}
            <dt>{shortDate(new Date(run.at))}</dt>
            <dd class:failed={runFailed(run)}>
              {#if runFailed(run)}<Icon name="alert" class="h-3.5 w-3.5 shrink-0" />{/if}<span>{runText(run)}</span>
            </dd>
          {/each}
        </dl>
      {:else}<p class="text-[0.8125rem] text-muted-foreground">Not run yet.</p>{/if}
    </div>
  {/if}
</li>

<style>
  .schedule-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.875rem 1rem;
    list-style: none;
  }
  .schedule-card:has(:global(.schedule-form)) {
    border: 0;
    padding: 0;
  }
  .runs {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .run-list {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    font-size: 0.8125rem;
  }
  .run-list dt {
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .run-list dd {
    display: flex;
    gap: 0.375rem;
    align-items: center;
  }
  .run-list dd.failed {
    color: var(--warning-foreground);
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  @media (max-width: 640px) {
    .run-list {
      grid-template-columns: 1fr;
      gap: 0 0;
    }
    .run-list dd {
      margin-bottom: 0.375rem;
    }
  }
</style>
