<script lang="ts">
  import Icon from "../../../lib/ui/Icon.svelte";
  import { describeSchedule, nextRun, parseCron, shortDate } from "../../../../../server/src/contract/cron";
  import type { Segment } from "../session-turns";
  // A schedule the agent added, as it was saved: when, its next run, where runs go, and what it sends.
  let { segment }: { segment: Extract<Segment, { kind: "schedule" }> } = $props();
  const schedule = $derived(segment.schedule);
  const next = $derived.by(() => {
    const at = schedule.next
      ? new Date(schedule.next)
      : schedule.cron
        ? nextRunOf(schedule.cron)
        : schedule.at
          ? new Date(schedule.at)
          : undefined;
    return at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now() ? `Next ${shortDate(at)}` : undefined;
  });
  const nextRunOf = (text: string) => {
    const cron = parseCron(text);
    return cron ? nextRun(cron, new Date()) : undefined;
  };
  const where = $derived(schedule.run === "new" ? "runs in a new session" : "runs in this session");
</script>

<div class="schedule" data-purpose="schedule-card">
  <span class="mark" aria-hidden="true"><Icon name="clock" class="h-4 w-4" /></span>
  <div class="body">
    <p class="when">
      {describeSchedule(schedule)}{#if !schedule.on}<span class="off"> · off</span>{/if}
    </p>
    <p class="sub">{[next, where].filter(Boolean).join(" · ")}</p>
    {#if schedule.prompt}<p class="prompt">“{schedule.prompt}”</p>{/if}
  </div>
</div>

<style>
  .schedule {
    display: flex;
    gap: 0.75rem;
    max-width: 30rem;
    padding: 0.75rem 0.875rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--card);
  }
  .mark {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    color: var(--foreground);
  }
  .body {
    min-width: 0;
  }
  p {
    margin: 0;
  }
  .when {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--foreground);
  }
  .off {
    font-weight: 400;
    color: var(--muted-foreground);
  }
  .sub {
    margin-top: 0.125rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .prompt {
    margin-top: 0.375rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
</style>
