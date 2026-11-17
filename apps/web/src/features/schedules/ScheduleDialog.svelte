<script lang="ts">
  /**
   * A schedule in a dialog (set 7): when it runs, read back in words; the prompt; how each run is
   * kept; its last run with Run now and the earlier runs; Delete, Cancel, Save. Adding one is the
   * same dialog, empty. On a phone the dialog is a sheet.
   */
  import { tick } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Modal from "../../lib/ui/Modal.svelte";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import { describeSchedule, shortDate } from "../../../../server/src/contract/cron";
  import type { ScheduleSummary } from "../../../../server/src/contract/schedule-protocol";
  import type { ReportMode } from "../../../../server/src/contract/wake-protocol";
  import { href } from "../../routes";
  import { useSessions } from "../workspace/session-client.svelte";
  import { sessionName } from "../workspace/session-presentation";
  import { choiceOf, runFailed, runText, whenOf, type Repeat } from "./schedule-presentation";

  let { sessionId, schedule, onclose }: { sessionId: string; schedule?: ScheduleSummary; onclose: () => void } = $props();
  const client = useSessions();
  const schedules = client.schedules;
  const id = $props.id();
  const session = $derived(client.sessions.find((s) => s.id === sessionId));
  const where = $derived(session ? sessionName(session) : (schedule?.session.title ?? schedule?.session.agent.name ?? "this session"));
  // A session another session started keeps its runs in itself.
  const child = $derived(!!session?.parent);
  // The live copy, so Run now's new run shows here.
  const current = $derived(schedule ? (schedules.schedules.find((s) => s.id === schedule.id) ?? schedule) : undefined);

  // svelte-ignore state_referenced_locally
  const start = choiceOf(schedule);
  let repeat = $state<string>(start.repeat);
  let time = $state(start.time);
  let date = $state(start.date);
  let weekday = $state(start.weekday);
  let every = $state(start.every);
  let cron = $state(start.cron);
  // svelte-ignore state_referenced_locally
  let prompt = $state(schedule?.prompt ?? "");
  // svelte-ignore state_referenced_locally
  let run = $state<string>(schedule?.run ?? "here");
  // svelte-ignore state_referenced_locally
  let report = $state<string>(schedule?.report ?? "status");
  let error = $state("");
  let saving = $state(false);
  let running = $state(false);
  let confirming = $state(false);
  const when = $derived(whenOf({ repeat: repeat as Repeat, time, date, weekday, every, cron }));
  const reads = $derived("error" in when ? "" : describeSchedule(when));

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
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if ("error" in when) return void (error = when.error);
    if (!prompt.trim()) return void (error = "Write the prompt to send.");
    saving = true;
    const input = { ...when, prompt, ...(child ? {} : { run: run as "here" | "new" }), ...(run === "new" ? { report: report as ReportMode } : {}) };
    const done = await act(() => (schedule ? schedules.update(schedule.id, input) : schedules.add({ ...input, sessionId })));
    saving = false;
    if (done) onclose();
  }
  async function runNow() {
    if (!schedule) return;
    running = true;
    await act(() => schedules.run(schedule.id));
    running = false;
  }
  let form = $state<HTMLFormElement>();
  /** Asking moves focus to Cancel; cancelling puts it back on Delete. */
  async function confirmDelete(asking: boolean) {
    confirming = asking;
    await tick();
    form?.closest("dialog")?.querySelector<HTMLElement>(asking ? "[data-cancel]" : "[data-delete]")?.focus();
  }
  async function remove() {
    if (schedule && (await act(() => schedules.remove(schedule.id)))) onclose();
  }

  const repeats = [
    { value: "once", label: "Once" },
    { value: "day", label: "Every day" },
    { value: "weekdays", label: "Weekdays" },
    { value: "week", label: "Every week" },
    { value: "hours", label: "Every few hours" },
    { value: "minutes", label: "Every few minutes" },
    { value: "cron", label: "Cron" },
  ];
  const runs = [
    { value: "here", label: "This session" },
    { value: "new", label: "A new session" },
  ];
  const reports = [
    { value: "result", label: "The result" },
    { value: "status", label: "A status line" },
    { value: "none", label: "Nothing" },
  ];
  const reportHelp: Record<string, string> = {
    result: "Each run’s answer comes back here and this session’s agent carries on with it.",
    status: "A line here when each run finishes. A run that finds something needing this session can still raise it.",
    none: "Nothing comes back here; the runs are listed under this session.",
  };
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => ({ value: String(index), label }));
  const REPORTS = { result: "its result comes back to the session", status: "tells the session a status line", none: "tells the session nothing" } as const;
</script>

<Modal label={schedule ? "Schedule" : "Add a schedule"} title={schedule ? "Schedule" : "Add a schedule"} onclose={() => !saving && onclose()} busy={saving} dismiss={false} asking={confirming}>
  {#snippet primary()}<Button type="submit" form={`${id}-form`} variant="primary" loading={saving}>Save</Button>{/snippet}
  {#snippet footer()}
    {#if schedule && !confirming}<Button variant="destructive" class="delete" data-delete onclick={() => void confirmDelete(true)}
        >Delete<span class="sheet-word"> schedule</span></Button
      ><span class="flex-1"></span>{/if}
  {/snippet}
  <form bind:this={form} id={`${id}-form`} class="space-y-4" aria-label={schedule ? "Change the schedule" : "Add a schedule"} onsubmit={save} novalidate>
    <p class="lead">
      <Icon name="clock" class="h-4 w-4 shrink-0" /><strong class="shrink-0">{reads || "Choose when"}</strong><span class="muted truncate">· in “{where}”</span>
    </p>
    <div class="fields">
      <div class="field">
        <span class="label" id="{id}-repeat">Repeat</span>
        <Selector label="Repeat" options={repeats} bind:value={repeat} />
      </div>
      {#if repeat === "week"}
        <div class="field">
          <span class="label">On</span>
          <div class="min-w-0 overflow-x-auto"><Segmented label="Day of the week" options={weekdays} bind:value={weekday} /></div>
        </div>
      {/if}
      {#if repeat === "once"}
        <div class="field">
          <label class="label" for="{id}-date">Date</label>
          <Input id="{id}-date" type="date" bind:value={date} class="w-44" density="compact" />
        </div>
      {/if}
      {#if ["once", "day", "weekdays", "week"].includes(repeat)}
        <div class="field">
          <label class="label" for="{id}-time">At</label>
          <Input id="{id}-time" type="time" bind:value={time} class="w-36" density="compact" aria-describedby="{id}-when" />
          <!-- The times are the server's, which may not be this device's. -->
          <span class="note" id="{id}-when">server time</span>
        </div>
      {:else if repeat === "hours" || repeat === "minutes"}
        <div class="field">
          <label class="label" for="{id}-every">Every</label>
          <div class="flex items-center gap-2">
            <div class="number"><Input id="{id}-every" type="number" min="1" max={repeat === "hours" ? 23 : 59} bind:value={every} density="compact" /></div>
            <span class="text-sm">{repeat === "hours" ? "hours" : "minutes"}</span>
          </div>
        </div>
      {:else}
        <div class="field">
          <label class="label" for="{id}-cron">Cron</label>
          <div class="min-w-0 flex-1">
            <Input id="{id}-cron" monospace bind:value={cron} placeholder="0 9 * * 1-5" aria-describedby="{id}-cron-help" density="compact" />
            <p id="{id}-cron-help" class="note mt-1">Minute, hour, day of month, month, day of week.</p>
          </div>
        </div>
      {/if}
      {#if !child}
        <div class="field">
          <span class="label">Each run</span>
          <Segmented label="Each run" options={runs} bind:value={run} />
        </div>
        {#if run === "new"}
          <div class="field">
            <span class="label">Tell this session</span>
            <Segmented label="Tell this session" options={reports} bind:value={report} />
          </div>
        {/if}
      {/if}
    </div>
    {#if !child && run === "new"}<p class="note">
        Each run is its own session under this session, so this conversation stays clean. {reportHelp[report]}
      </p>{/if}
    <div class="space-y-1.5">
      <label for="{id}-prompt" class="block text-sm font-medium">Prompt</label>
      <Textarea id="{id}-prompt" rows={3} bind:value={prompt} aria-describedby="{id}-prompt-help" class="w-full" />
      <p id="{id}-prompt-help" class="note">
        {run === "new" ? "Sent as the first message of each run’s session. " : ""}Runs while you’re away use this session’s agent and tools, with this
        computer’s permissions.
      </p>
    </div>
    {#if current}
      {@const last = current.runs[0]}
      <div class="fields">
        <div class="field">
          <span class="label">Last run</span>
          <span class="flex-1 min-w-0 text-sm" class:failed={last && runFailed(last)}
            >{#if last}{runFailed(last) ? "! " : ""}{shortDate(new Date(last.at))} · {runText(last)}{:else}Not run yet{/if}</span
          >
          <Button size="compact" loading={running} unavailable={current.held ? "Restore the session first" : undefined} onclick={() => void runNow()}
            >Run now</Button
          >
        </div>
      </div>
      {#if current.runs.length > 1 || current.by === "agent" || current.run === "new"}
        <Disclosure title={`Runs (${current.runs.length})`}>
          <p class="note mt-2">
            {current.run === "new" ? `Each run in a new session · ${REPORTS[current.report ?? "status"]}` : "Each run in this session"}{current.by === "agent"
              ? " · Added by the agent after you said yes"
              : ""}
          </p>
          <dl class="run-list">
            {#each current.runs as each (each.at + each.due)}
              <dt>{shortDate(new Date(each.at))}</dt>
              <dd class:failed={runFailed(each)}>
                {runText(each)}{#if each.session && client.sessions.some((s) => s.id === each.session)}{" "}<a
                    class="link"
                    href={href({ name: "session", id: each.session })}
                    onclick={onclose}>Open<span class="sr-only"> the session of this run</span></a
                  >{/if}
              </dd>
            {/each}
          </dl>
        </Disclosure>
      {/if}
    {/if}
    {#if error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
    {#if confirming}
      <div class="actions" role="group" aria-label="Delete this schedule">
        <p class="text-sm flex-1">Delete this schedule? Its runs stay in the session.</p>
        <Button
          data-cancel
          onclick={() => void confirmDelete(false)}
          onkeydown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              void confirmDelete(false);
            }
          }}>Cancel</Button
        >
        <Button variant="destructive" onclick={() => void remove()}>Delete</Button>
      </div>
    {/if}
  </form>
</Modal>

<style>
  .lead {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    font-size: var(--text-sm);
  }
  .muted {
    color: var(--muted-foreground);
  }
  .fields {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 2.75rem;
    padding: 0.375rem 0.75rem;
    font-size: var(--text-sm);
  }
  .field + .field {
    border-top: 1px solid var(--border);
  }
  .label {
    width: 6.5rem;
    flex-shrink: 0;
    color: var(--muted-foreground);
  }
  /* A phone keeps each row on one line: a narrower label, choices side by side. */
  @media (max-width: 599.98px) {
    .label {
      width: 4.75rem;
    }
    .field :global(label) {
      white-space: nowrap;
    }
  }
  .note {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .number {
    width: 5.5rem;
  }
  .failed {
    color: var(--warning-foreground);
    font-weight: 600;
  }
  /* "Delete schedule" at the bottom of the phone sheet; "Delete" beside Cancel and Save elsewhere. */
  .sheet-word {
    display: none;
  }
  @media (max-width: 599.98px) {
    .sheet-word {
      display: inline;
    }
    :global(.ui-button.delete) {
      width: 100%;
    }
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .run-list {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    margin-top: 0.5rem;
    font-size: var(--text-xs);
  }
  .run-list dt {
    color: var(--muted-foreground);
    white-space: nowrap;
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
