<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import { describeSchedule, shortDate } from "../../../../server/src/contract/cron";
  import type { Routine } from "../../../../server/src/contract/schedule-protocol";
  import { useSessions } from "../workspace/session-client.svelte";
  /** The routines a persona offers: each with its switch, next run, recent runs and Run now. */
  let { persona }: { persona: string } = $props();
  const client = useSessions();
  const routines = $derived(client.routines.of(persona));
  let error = $state("");
  let busy = $state<string>();
  $effect(() => void client.routines.refresh().catch(() => {}));
  async function act(routine: Routine, work: () => Promise<void>) {
    error = "";
    busy = routine.id;
    try {
      await work();
      await client.refresh().catch(() => {});
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      busy = undefined;
    }
  }
  const status = (routine: Routine) =>
    !routine.on ? "Off" : client.schedules.paused ? "Paused" : routine.next ? `Next ${shortDate(new Date(routine.next))}` : "On";
</script>

<div class="space-y-3">
  {#if client.schedules.paused}<p role="status" class="text-sm text-muted-foreground">Unattended runs are paused in Settings → Background.</p>{/if}
  {#if routines.length}
    <ul class="space-y-3" aria-label="Routines">
      {#each routines as routine (routine.id)}
        <li class="routine">
          <div class="flex flex-wrap items-start gap-3">
            <div class="pt-0.5">
              <Toggle
                label={`Run ${routine.name}`}
                checked={routine.on}
                onchange={(event) => void act(routine, () => client.routines.set(routine, (event.currentTarget as HTMLInputElement).checked))}
              />
            </div>
            <div class="min-w-0" style="flex: 1 1 12rem">
              <p class="text-sm font-medium">{routine.name}</p>
              <p class="mt-0.5 text-xs text-muted-foreground">{describeSchedule({ cron: routine.cron })} · {status(routine)}</p>
              <p class="mt-2 whitespace-pre-wrap break-words text-sm">{routine.prompt}</p>
              {#if routine.runs.length}<p class="mt-2 text-[0.8125rem] text-muted-foreground">
                  Recent runs:
                  {#each routine.runs.slice(0, 3) as run, index (run.session)}{index ? " · " : ""}{#if client.sessions.some((s) => s.id === run.session)}<button
                        type="button"
                        class="link"
                        onclick={() => client.select(run.session)}>{shortDate(new Date(run.due)).split(",")[0]}</button
                      >{:else}{shortDate(new Date(run.due)).split(",")[0]}{run.archived ? " (archived)" : ""}{/if}{/each}
                </p>{/if}
            </div>
            <div class="ml-auto flex shrink-0 gap-1">
              <Button size="compact" loading={busy === routine.id} onclick={() => void act(routine, () => client.routines.run(routine))}>Run now</Button>
            </div>
          </div>
        </li>
      {/each}
    </ul>
    <p class="flex items-start gap-2 text-[0.8125rem] text-muted-foreground">
      <Icon name="alert" class="mt-0.5 h-4 w-4 shrink-0" /><span
        >The persona offers these. Each is off until you switch it on. Runs while you’re away use this persona and its tools, with this server’s
        permissions. The newest 10 runs stay listed; older ones are archived.</span
      >
    </p>
  {:else}<p class="text-sm text-muted-foreground">This persona offers no routines.</p>{/if}
  {#if error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
</div>

<style>
  .routine {
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
