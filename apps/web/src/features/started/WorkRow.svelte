<script lang="ts">
  /**
   * One row for anything a session started. A child session, a process and a schedule look and
   * behave alike: the row opens the thing itself, and its one control stops it or switches it.
   */
  import type { ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
  import Icon from "../../lib/ui/Icon.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import { details } from "../workspace/details.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import { sessionName } from "../workspace/session-presentation";
  import AskMark from "./AskMark.svelte";
  import type { Work, WorkKind } from "./work";

  let {
    work,
    owner = false,
    onschedule,
  }: {
    work: Work;
    /** Name the conversation it belongs to: on Background, where rows of every conversation meet. */
    owner?: boolean;
    /** A schedule's row opens its form, which whoever lists the rows shows. */
    onschedule: (schedule: ScheduleSummary) => void;
  } = $props();
  const client = useSessions();
  const ICON: Record<Exclude<WorkKind, "session">, "terminal" | "clock" | "pin"> = { process: "terminal", schedule: "clock", kept: "pin" };
  const detail = $derived(owner ? `${sessionName(work.owner)} · ${work.detail}` : work.detail);

  /** Where a row leads: a child's conversation, a process's output, a schedule's form, or (kept running) its conversation. */
  function open() {
    if (work.kind === "session") client.open(work.ref);
    else if (work.kind === "process") details.show(work.owner.id, "tasks", work.ref);
    else if (work.kind === "schedule" && work.schedule) onschedule(work.schedule);
    else client.open(work.owner.id);
  }
  /** Stop is the same act for every kind; a child also stops what it started. */
  function stop() {
    if (work.kind === "session") void client.stop(work.ref);
    else if (work.kind === "process") void client.processes.stop(work.owner.id, work.ref);
    else if (work.kind === "kept") void client.hold(work.owner.id, "release-hold");
  }
</script>

<div class="work" data-purpose="work-row" data-kind={work.kind}>
  <button type="button" class="open" aria-haspopup={work.kind === "schedule" ? "dialog" : undefined} onclick={open}>
    <span class="lead">
      {#if work.kind === "session"}{#if work.state}<AskMark state={work.state} />{/if}{:else}<Icon name={ICON[work.kind]} class="h-4 w-4" />{/if}
    </span>
    <span class="text">
      <span class="title" class:mono={work.kind === "process"}>{work.title}</span>
      <span class="detail">{detail}</span>
    </span>
  </button>
  {#if work.schedule}
    {@const schedule = work.schedule}
    <Toggle
      label={`Run ${work.title}`}
      checked={schedule.on}
      disabled={!!schedule.held}
      onchange={(event) => void client.schedules.update(schedule.id, { on: (event.currentTarget as HTMLInputElement).checked }).catch(() => {})}
    />
  {:else if work.open}
    <button type="button" class="stop" aria-label={`Stop ${work.title}`} title="Stop" onclick={stop}><Icon name="stop" class="h-4 w-4" /></button>
  {/if}
</div>

<style>
  .work {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2.75rem;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2.75rem;
    padding: 0.25rem 0.5rem;
    margin-left: -0.5rem;
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .open:hover {
    background: var(--muted);
  }
  .lead {
    width: 1.125rem;
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .title,
  .detail {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-size: var(--text-sm);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .detail {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .stop {
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  /* Compact: a full-size tap target. */
  @media (max-width: 599px) {
    .stop {
      width: 2.75rem;
      height: 2.75rem;
    }
  }
  .stop:hover {
    background: var(--muted);
    color: var(--foreground);
  }
</style>
