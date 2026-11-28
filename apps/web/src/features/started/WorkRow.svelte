<script lang="ts">
  /**
   * One row for anything a session started. A child session, a process, a schedule and a routine
   * look and behave alike: the row opens the thing itself, and its one control stops it or
   * switches it.
   */
  import type { Routine, ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
  import Icon from "../../lib/ui/Icon.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import { details } from "../workspace/details.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import AskMark from "./AskMark.svelte";
  import type { Work, WorkKind } from "./work";

  let {
    work,
    named = false,
    expanded,
    onschedule,
    onroutine,
  }: {
    work: Work;
    /** Say whom it belongs to: on Background, where the rows of every conversation meet. */
    named?: boolean;
    /** A routine's row unfolds what it sends and its runs, under it: whether that shows. */
    expanded?: boolean;
    /** A schedule's row opens its form, which whoever lists the rows shows. */
    onschedule: (schedule: ScheduleSummary) => void;
    onroutine?: (routine: Routine) => void;
  } = $props();
  const client = useSessions();
  const ICON: Record<Exclude<WorkKind, "session">, "terminal" | "clock" | "pin"> = {
    process: "terminal",
    schedule: "clock",
    routine: "clock",
    kept: "pin",
  };
  const detail = $derived(named ? `${work.of} · ${work.detail}` : work.detail);

  /** Where a row leads: a child's conversation, a process's output, a schedule's form, a routine's runs, or (kept running) its conversation. */
  function open() {
    if (work.kind === "session") client.open(work.ref);
    else if (work.schedule) onschedule(work.schedule);
    else if (work.routine) onroutine?.(work.routine);
    else if (work.kind === "process" && work.owner) details.show(work.owner.id, "tasks", work.ref);
    else if (work.owner) client.open(work.owner.id);
  }
  /** Stop is the same act for every kind; a child also stops what it started. */
  function stop() {
    if (work.kind === "session") void client.stop(work.ref);
    else if (work.kind === "process" && work.owner) void client.processes.stop(work.owner.id, work.ref);
    else if (work.kind === "kept" && work.owner) void client.hold(work.owner.id, "release-hold");
  }
  /** A schedule's or a routine's own switch. */
  function switched(on: boolean) {
    if (work.schedule) void client.schedules.update(work.schedule.id, { on }).catch(() => {});
    else if (work.routine)
      void client.routines
        .set(work.routine, on)
        .then(() => client.refresh())
        .catch(() => {});
  }
  const timer = $derived(work.schedule ?? work.routine);
</script>

<div class="work" data-purpose="work-row" data-kind={work.kind}>
  <button
    type="button"
    class="open"
    aria-haspopup={work.schedule ? "dialog" : undefined}
    aria-expanded={work.routine ? !!expanded : undefined}
    onclick={open}
  >
    <span class="lead">
      {#if work.kind === "session"}{#if work.state}<AskMark state={work.state} />{/if}{:else}<Icon
          name={ICON[work.kind]}
          class="h-4 w-4"
        />{/if}
    </span>
    <span class="text">
      <span class="title" class:mono={work.kind === "process"}>{work.title}</span>
      <span class="detail" class:bad={work.failed}>{detail}</span>
    </span>
  </button>
  {#if timer}
    <Toggle
      label={`Run ${work.title}`}
      checked={timer.on}
      disabled={!!work.schedule?.held}
      onchange={(event) => switched((event.currentTarget as HTMLInputElement).checked)}
    />
  {:else if work.open}
    <button type="button" class="stop" aria-label={`Stop ${work.title}`} title="Stop" onclick={stop}>
      <Icon name="stop" class="h-4 w-4" />
    </button>
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
  /* A failed last run stands out by weight, not by colour alone. */
  .bad {
    font-weight: 600;
    color: var(--foreground);
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
