<script lang="ts">
  /**
   * One owner's things on the Background screen (design set 5): its head says who and where and
   * opens it; under it one row per thing. A reply working, a background task, keeping it running,
   * a schedule or routine with its last and next run on the same line. Every stop is the same stop
   * icon. A schedule or routine opens in place for Run now, changes and its runs.
   */
  import Icon from "../../lib/ui/Icon.svelte";
  import IdentityMark from "../../lib/ui/IdentityMark.svelte";
  import StatusMark from "../../lib/ui/StatusMark.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import { describeSchedule, shortDate } from "../../../../server/src/contract/cron";
  import type { Routine } from "../../../../server/src/contract/schedule-protocol";
  import { href } from "../../routes";
  import ScheduleDialog from "../schedules/ScheduleDialog.svelte";
  import type { ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
  import { nextText, runFailed } from "../schedules/schedule-presentation";
  import { details } from "../workspace/details.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import { elapsed, folderName, sessionName, STATE_WORDS } from "../workspace/session-presentation";
  import { useNow } from "../workspace/clock.svelte";
  import type { BackgroundGroup } from "./background-groups";
  import { processName, processState } from "./process-presentation";

  let { group, onerror }: { group: BackgroundGroup; onerror: (message: string) => void } = $props();
  const client = useSessions();
  // "Working · 43s" (design set 5): how long each reply here has run, ticking while one does.
  const clock = useNow(() => group.rows.some((row) => (row.kind === "session" && !!row.session.workingSince) || row.kind === "task"));
  const workingFor = (since?: string) => (since ? elapsed(Math.max(0, clock.now - Date.parse(since))) : undefined);
  const owner = $derived(group.owner);
  let open = $state<string>();
  /** The schedule open in its dialog. */
  let editing = $state<ScheduleSummary>();

  const who = $derived.by(() => {
    switch (owner.kind) {
      case "session":
        return { name: sessionName(owner.session), mark: owner.session.agent.name, where: `${owner.session.agent.name} · ${folderName(owner.session.folder)}` };
      case "app":
        return { name: owner.agent.name, mark: owner.agent.name, where: owner.folder ? `App · ${folderName(owner.folder)}` : "App" };
      case "agent":
        return { name: owner.agent.name, mark: owner.agent.name, where: "Agent" };
      case "archived":
        return { name: owner.title ?? "Archived session", mark: owner.agent.name, where: `Archived · ${owner.agent.name}` };
    }
  });

  async function act(work: () => Promise<unknown>) {
    try {
      await work();
    } catch (failure) {
      onerror((failure as Error).message);
    }
  }
  const routineStatus = (routine: Routine) =>
    !routine.on ? "Off" : client.schedules.paused ? "Paused" : routine.next ? `Next ${shortDate(new Date(routine.next))}` : "On";
  const toggle = (key: string) => (open = open === key ? undefined : key);
</script>

{#snippet head()}
  <IdentityMark name={who.mark} size="md" />
  <span class="who"><span class="name">{who.name}</span><span class="where">{who.where}</span></span>
  <Icon name="chevronRight" class="h-4 w-4 shrink-0 text-muted-foreground" />
{/snippet}

<section class="group" aria-label={who.name}>
  {#if owner.kind === "session"}<a class="head" href={href({ name: "session", id: owner.session.id })}>{@render head()}</a>
  {:else if owner.kind === "app"}<button type="button" class="head" onclick={() => void client.openApp(owner.agent.id)}>{@render head()}</button>
  {:else}<a class="head" href={owner.kind === "agent" ? href({ name: "agents" }) : href({ name: "archived" })}>{@render head()}</a>{/if}
  <ul>
    {#each group.rows as row (row.key)}
      <li>
        {#if row.kind === "session"}
          <a class="row" href={href({ name: "session", id: row.session.id })}>
            <StatusMark
              kind={row.state === "needs-you" ? "attention" : row.state === "queued" ? "waiting" : "busy"}
              label={STATE_WORDS[row.state]}
              words
              detail={row.state === "working" ? workingFor(row.session.workingSince) : undefined}
            />
            {#if owner.kind !== "session"}<span class="what meta">{sessionName(row.session)}</span>{:else}<span class="what"></span>{/if}
          </a>
        {:else if row.kind === "task"}
          <div class="row">
            <Icon name="terminal" class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="what"><span class="mono">{processName(row.process)}</span><span class="meta">{" · "}{processState(row.process, clock.now)}</span></span>
            <button
              type="button"
              class="icon"
              aria-label={`Show output of ${processName(row.process)}`}
              title="Show output"
              onclick={() => details.show(row.process.sessionId, "tasks", row.process.id)}><Icon name="expand" class="h-4 w-4" /></button
            >
            <button
              type="button"
              class="icon"
              aria-label={`Stop ${processName(row.process)}`}
              title="Stop"
              onclick={() => void act(() => client.processes.stop(row.process.sessionId, row.process.id))}><Icon name="stop" class="h-4 w-4" /></button
            >
          </div>
        {:else if row.kind === "kept"}
          <div class="row">
            <Icon name="pin" class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="what">Kept running by {row.session.held!.extension}<span class="meta">{" · "}{row.session.held!.reason}</span></span>
            <button
              type="button"
              class="icon"
              aria-label={`Stop keeping ${sessionName(row.session)} running`}
              title="Stop keeping it running"
              onclick={() => void act(() => client.hold(row.session.id, "release-hold"))}><Icon name="stop" class="h-4 w-4" /></button
            >
          </div>
        {:else if row.kind === "schedule"}
          {@const schedule = row.schedule}
          {@const last = schedule.runs[0]}
          {@const when = describeSchedule(schedule)}
          <div class="row">
            <Icon name="clock" class="h-4 w-4 shrink-0 text-muted-foreground" />
            <button type="button" class="what text-left" aria-haspopup="dialog" onclick={() => (editing = schedule)}>
              <span class="block">{when}</span>
              <span class="meta block"
                >{#if last}<span class:failed={runFailed(last)}>{runFailed(last) ? "Failed" : "Ran"} {shortDate(new Date(last.at))}</span>{" · "}{/if}{nextText(
                  schedule,
                  client.schedules.paused,
                )}</span
              >
            </button>
            <Toggle
              label={`Run ${when}`}
              checked={schedule.on}
              disabled={!!schedule.held}
              onchange={(event) => void act(() => client.schedules.update(schedule.id, { on: (event.currentTarget as HTMLInputElement).checked }))}
            />
          </div>
        {:else}
          {@const routine = row.routine}
          <div class="row">
            <Icon name="clock" class="h-4 w-4 shrink-0 text-muted-foreground" />
            <button type="button" class="what text-left" aria-expanded={open === row.key} onclick={() => toggle(row.key)}>
              <span class="block">{routine.name} · {describeSchedule({ cron: routine.cron })}</span>
              <span class="meta block"
                >{#if routine.runs[0]}Ran {shortDate(new Date(routine.runs[0].due))}{" · "}{/if}{routineStatus(routine)}</span
              >
            </button>
            <Toggle
              label={`Run ${routine.name}`}
              checked={routine.on}
              onchange={(event) => void act(() => client.routines.set(routine, (event.currentTarget as HTMLInputElement).checked).then(() => client.refresh()))}
            />
          </div>
          {#if open === row.key}<div class="more">
              <p class="prompt">{routine.prompt}</p>
              {#if routine.runs.length}<p class="meta">
                  Recent runs:
                  {#each routine.runs.slice(0, 3) as run, index (run.session)}{index ? " · " : ""}{#if client.sessions.some((s) => s.id === run.session)}<a
                        class="link"
                        href={href({ name: "session", id: run.session })}>{shortDate(new Date(run.due))}</a
                      >{:else}{shortDate(new Date(run.due))}{run.archived ? " (archived)" : ""}{/if}{/each}
                </p>{/if}
              <Button size="compact" onclick={() => void act(() => client.routines.run(routine).then(() => client.refresh()))}>Run now</Button>
            </div>{/if}
        {/if}
      </li>
    {/each}
  </ul>
</section>

{#if editing}<ScheduleDialog sessionId={editing.sessionId} schedule={editing} onclose={() => (editing = undefined)} />{/if}

<style>
  .group {
    border: 1px solid var(--border);
    border-radius: var(--radius-card, var(--radius-md));
    background: var(--card, var(--background));
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  .head:hover {
    background: var(--accent);
  }
  .who {
    flex: 1;
    min-width: 0;
  }
  .name,
  .where {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-size: var(--text-base);
    font-weight: 600;
  }
  .where {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  li + li {
    border-top: 1px solid var(--border);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    padding: 0.25rem 0.5rem 0.25rem 0.875rem;
    font-size: var(--text-sm);
  }
  a.row:hover {
    background: var(--accent);
  }
  .what {
    flex: 1;
    min-width: 0;
  }
  button.what {
    padding: 0.125rem 0;
  }
  button.what:hover > :first-child {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .meta {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .failed {
    font-weight: 600;
    color: var(--warning-foreground);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
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
  .more {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0 0.875rem 0.75rem 2.375rem;
  }
  .prompt {
    font-size: var(--text-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  :global([data-size="compact"]) .row {
    min-height: 2.75rem;
  }
  :global([data-size="compact"]) .icon {
    width: 2.75rem;
    height: 2.75rem;
  }
</style>
