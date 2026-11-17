<script lang="ts">
  /**
   * A session's Details (design language §1.5a): a stack of foldable panels. Session (agent, model,
   * folder, when and by whom it started), its schedules, its background tasks, the sessions it
   * started, its agent's routines and what keeps it running. Each row acts with a small icon; the
   * longer work (a schedule's form, a process's output, editing the agent) opens as a view in the
   * same panel, with Back to here.
   */
  import Fold from "../../lib/ui/Fold.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import StatusMark from "../../lib/ui/StatusMark.svelte";
  import { describeSchedule } from "../../../../server/src/contract/cron";
  import type { Routine } from "../../../../server/src/contract/schedule-protocol";
  import { layout } from "../../shell/layout.svelte";
  import { processName, processState } from "../background/process-presentation";
  import { nextText } from "../schedules/schedule-presentation";
  import ScheduleDialog from "../schedules/ScheduleDialog.svelte";
  import type { ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
  import ContributionPoint from "./ContributionPoint.svelte";
  import { details } from "./details.svelte";
  import { useSession, useSessions } from "./session-client.svelte";
  import { modelName, sessionName, sessionStarted, sessionState, sessionStatus } from "./session-presentation";

  const client = useSessions();
  const session = useSession();
  const info = $derived(session.info);
  const model = $derived(modelName(client.providers.catalog.providers, session.doc?.model));
  const parent = $derived(info?.parent ? client.sessions.find((each) => each.id === info.parent) : undefined);
  const schedules = $derived(info ? client.schedules.of(info.id) : []);
  const tasks = $derived(info ? client.processes.running.filter((p) => p.sessionId === info.id) : []);
  const started = $derived(info ? client.sessions.filter((each) => each.parent === info.id) : []);
  const routines = $derived(info ? client.routines.of(info.agent.id) : []);
  let routineError = $state("");
  /** The schedule open in its dialog; `true` for a new one. */
  let editing = $state<ScheduleSummary | true>();

  async function switchRoutine(routine: Routine, on: boolean) {
    routineError = "";
    try {
      await client.routines.set(routine, on);
      await client.refresh().catch(() => {});
    } catch (failure) {
      routineError = (failure as Error).message;
    }
  }
</script>

{#if info}
  <div class="panels">
    <Fold title="Session">
      <dl class="facts">
        <div>
          <dt>Agent</dt>
          <dd>{info.agent.name}{#if info.agent.layered}<span class="muted"> · edited for this session</span>{/if}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{model ?? "Not available"}</dd>
        </div>
        <div>
          <dt>Folder</dt>
          <dd class="path">{info.folder}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{sessionStarted(info)}</dd>
        </div>
        {#if parent}<div>
            <dt>Started by</dt>
            <dd><button type="button" class="link" onclick={() => client.open(parent.id)}>{sessionName(parent)}</button></dd>
          </div>{/if}
      </dl>
      <!-- An extension's title chips sit beside the name on wide screens, and here otherwise. -->
      {#if layout.size !== "expanded" && session.doc}<div class="chips"><ContributionPoint point="session.title" /></div>{/if}
    </Fold>

    <Fold title="Schedules" count={schedules.length ? String(schedules.length) : undefined}>
      {#snippet action()}<button
          type="button"
          class="icon"
          aria-label="Add a schedule"
          title="Add a schedule"
          onclick={() => (editing = true)}><Icon name="plus" class="h-4 w-4" /></button
        >{/snippet}
      {#if schedules.length}
        <ul class="rows" aria-label="Schedules of this session">
          {#each schedules as schedule (schedule.id)}<li class="row">
              <button type="button" class="row grow" aria-haspopup="dialog" onclick={() => (editing = schedule)}>
                <span class="line">{describeSchedule(schedule)}</span>
                <span class="sub">{nextText(schedule, client.schedules.paused)}</span>
              </button>
              <Toggle
                label={`Run ${describeSchedule(schedule)}`}
                checked={schedule.on}
                disabled={!!schedule.held}
                onchange={(event) => void client.schedules.update(schedule.id, { on: (event.currentTarget as HTMLInputElement).checked }).catch(() => {})}
              />
            </li>{/each}
        </ul>
      {:else}<p class="note">None. Add one, or ask the agent: “check again in 30 minutes”.</p>{/if}
    </Fold>

    {#if tasks.length || info.processes}<Fold title="Background tasks" count={tasks.length ? `${tasks.length} running` : undefined}>
        {#if tasks.length}
          <ul class="rows" aria-label="Background tasks of this session">
            {#each tasks as task (task.id)}<li class="row">
                <Icon name="terminal" class="h-4 w-4 shrink-0 text-muted-foreground" />
                <span class="grow"><span class="line mono">{processName(task)}</span><span class="sub">{processState(task)}</span></span>
                <button
                  type="button"
                  class="icon"
                  aria-label={`Show output of ${processName(task)}`}
                  title="Show output"
                  onclick={() => details.show(session.id, "tasks", task.id)}><Icon name="expand" class="h-4 w-4" /></button
                >
                <button
                  type="button"
                  class="icon"
                  aria-label={`Stop ${processName(task)}`}
                  title="Stop"
                  onclick={() => void client.processes.stop(session.id, task.id)}><Icon name="stop" class="h-4 w-4" /></button
                >
              </li>{/each}
          </ul>
        {:else}<p class="note">None running.</p>{/if}
      </Fold>{/if}

    {#if started.length}<Fold title="Sessions it started" count={String(started.length)}>
        <ul class="rows" aria-label="Sessions it started">
          {#each started as child (child.id)}
            {@const state = sessionState(child)}
            <li class="row">
              <button type="button" class="grow link line" onclick={() => client.open(child.id)}>{sessionName(child)}</button>
              {#if state}<StatusMark
                  kind={state === "needs-you" ? "attention" : state === "failed" ? "error" : state === "queued" ? "waiting" : "busy"}
                  label={sessionStatus(child)}
                  words
                />{:else}<span class="sub">Finished</span>{/if}
              {#if state === "working" || state === "queued"}<button
                  type="button"
                  class="icon"
                  aria-label={`Stop ${sessionName(child)}`}
                  title="Stop"
                  onclick={() => void client.stop(child.id)}><Icon name="stop" class="h-4 w-4" /></button
                >{/if}
            </li>
          {/each}
        </ul>
        <p class="note">Each tells this session when it ends.</p>
      </Fold>{/if}

    {#if routines.length}<Fold title={`Routines of ${info.agent.name}`}>
        {#snippet action()}<button
            type="button"
            class="icon"
            aria-label="Show routines"
            title="Run now and recent runs"
            onclick={() => details.show(session.id, "routines")}><Icon name="expand" class="h-4 w-4" /></button
          >{/snippet}
        <ul class="rows" aria-label="Routines">
          {#each routines as routine (routine.id)}<li class="row">
              <span class="grow"
                ><span class="line">{routine.name}</span><span class="sub">{describeSchedule({ cron: routine.cron })}</span></span
              >
              <Toggle
                label={`Run ${routine.name}`}
                checked={routine.on}
                onchange={(event) => void switchRoutine(routine, (event.currentTarget as HTMLInputElement).checked)}
              />
            </li>{/each}
        </ul>
        {#if routineError}<p role="alert" class="note danger">{routineError}</p>{/if}
      </Fold>{/if}

    {#if info.held}<Fold title="Kept running">
        <div class="row">
          <Icon name="pin" class="h-4 w-4 shrink-0 text-muted-foreground" />
          <span class="grow line wrap"><strong>{info.held.extension}</strong>: {info.held.reason}</span>
          <button
            type="button"
            class="icon"
            aria-label="Stop keeping it running"
            title="Stop keeping it running"
            onclick={() => void client.hold(info.id, "release-hold")}><Icon name="stop" class="h-4 w-4" /></button
          >
        </div>
        <p class="note">Stays loaded while no one watches and starts again after a restart. Pause all stops it.</p>
      </Fold>{/if}
  </div>
{/if}

{#if editing}<ScheduleDialog sessionId={session.id} schedule={editing === true ? undefined : editing} onclose={() => (editing = undefined)} />{/if}

<style>
  .panels {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .facts {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    font-size: var(--text-sm);
  }
  .facts > div {
    display: flex;
    gap: 0.75rem;
    min-height: 1.75rem;
    align-items: baseline;
    padding: 0.125rem 0;
  }
  .facts dt {
    width: 5rem;
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .facts dd {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .path {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .muted {
    color: var(--muted-foreground);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0.25rem 0;
  }
  .chips:empty {
    display: none;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
    font-size: var(--text-sm);
  }
  .grow {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  button.row {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: 0.25rem 0;
  }
  button.row:hover .line {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .line {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line.wrap {
    white-space: normal;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .sub {
    display: block;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .note {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    padding: 0.125rem 0 0.25rem;
  }
  .danger {
    color: var(--danger-foreground);
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .icon:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  :global([data-size="compact"]) .icon {
    width: 2.75rem;
    height: 2.75rem;
  }
  :global([data-size="compact"]) .row {
    min-height: 2.75rem;
  }
</style>
