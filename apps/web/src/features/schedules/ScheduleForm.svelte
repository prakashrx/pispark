<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { describeSchedule } from "../../../../server/src/contract/cron";
  import type { Schedule, ScheduleInput } from "../../../../server/src/contract/schedule-protocol";
  import type { ReportMode } from "../../../../server/src/contract/wake-protocol";
  import { choiceOf, whenOf, type Repeat } from "./schedule-presentation";
  /** Adds a schedule, or changes one: when (plain choices, or cron) and the prompt. */
  let {
    schedule,
    child = false,
    onsave,
    oncancel,
  }: {
    schedule?: Schedule;
    /** The chat was started by another session, so its runs stay in it. */
    child?: boolean;
    /** Saves; a refusal is thrown in words and shown here. */
    onsave: (input: ScheduleInput) => Promise<void>;
    oncancel: () => void;
  } = $props();
  const id = $props.id();
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
  const when = $derived(whenOf({ repeat: repeat as Repeat, time, date, weekday, every, cron }));
  // How it reads, and the cron it writes when that was chosen in plain words.
  const reads = $derived(
    "error" in when
      ? ""
      : [describeSchedule(when), "cron" in when && repeat !== "cron" ? `as cron ${when.cron}` : "", "server time"].filter(Boolean).join(" · "),
  );

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if ("error" in when) return void (error = when.error);
    if (!prompt.trim()) return void (error = "Write the prompt to send.");
    error = "";
    saving = true;
    try {
      await onsave({ ...when, prompt, ...(child ? {} : { run: run as "here" | "new" }), ...(run === "new" ? { report: report as ReportMode } : {}) });
    } catch (failure) {
      error = (failure as Error).message;
    } finally {
      saving = false;
    }
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
    { value: "here", label: "In this chat" },
    { value: "new", label: "In a new session" },
  ];
  const reports = [
    { value: "result", label: "The result" },
    { value: "status", label: "A status line" },
    { value: "none", label: "Nothing" },
  ];
  const reportHelp: Record<string, string> = {
    result: "Each run’s answer comes back here and this chat’s agent carries on with it.",
    status: "A line here when each run finishes. A run that finds something needing this chat can still raise it.",
    none: "Nothing comes back here; the runs are listed under this chat.",
  };
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => ({ value: String(index), label }));
</script>

<form class="schedule-form space-y-4" aria-label={schedule ? "Change the schedule" : "Add a schedule"} onsubmit={save} novalidate>
  <h4 class="text-sm font-semibold">{schedule ? "Change the schedule" : "Add a schedule"}</h4>
  <div class="space-y-1.5">
    <span class="block text-sm font-medium" id="{id}-repeat">Repeat</span>
    <div class="overflow-x-auto pb-0.5"><Segmented label="Repeat" options={repeats} bind:value={repeat} /></div>
  </div>
  {#if repeat === "week"}
    <div class="space-y-1.5">
      <span class="block text-sm font-medium">On</span>
      <div class="overflow-x-auto pb-0.5"><Segmented label="Day of the week" options={weekdays} bind:value={weekday} /></div>
    </div>
  {/if}
  <div class="flex flex-wrap items-end gap-4">
    {#if repeat === "once"}
      <div class="space-y-1.5">
        <label for="{id}-date" class="block text-sm font-medium">Date</label>
        <Input id="{id}-date" type="date" bind:value={date} class="w-44" />
      </div>
    {/if}
    {#if ["once", "day", "weekdays", "week"].includes(repeat)}
      <div class="space-y-1.5">
        <label for="{id}-time" class="block text-sm font-medium">At</label>
        <Input id="{id}-time" type="time" bind:value={time} class="w-36" />
      </div>
    {:else if repeat === "hours" || repeat === "minutes"}
      <div class="space-y-1.5">
        <label for="{id}-every" class="block text-sm font-medium">Every</label>
        <div class="flex items-center gap-2">
          <div class="number"><Input id="{id}-every" type="number" min="1" max={repeat === "hours" ? 23 : 59} bind:value={every} /></div>
          <span class="text-sm">{repeat === "hours" ? "hours" : "minutes"}</span>
        </div>
      </div>
    {:else}
      <div class="space-y-1.5 min-w-0 flex-1">
        <label for="{id}-cron" class="block text-sm font-medium">Cron</label>
        <Input id="{id}-cron" monospace bind:value={cron} placeholder="0 9 * * 1-5" aria-describedby="{id}-cron-help" />
        <p id="{id}-cron-help" class="note">Minute, hour, day of month, month, day of week.</p>
      </div>
    {/if}
    {#if reads}<p class="note pb-2" aria-live="polite">{reads}</p>{/if}
  </div>
  <div class="space-y-1.5">
    <label for="{id}-prompt" class="block text-sm font-medium">Prompt</label>
    <Textarea id="{id}-prompt" rows={3} bind:value={prompt} aria-describedby="{id}-prompt-help" class="w-full" />
    <p id="{id}-prompt-help" class="note">
      {run === "new" ? "Sent as the first message of each run’s session; /commands work." : "Sent to this chat as if you typed it; /commands work."}
    </p>
  </div>
  {#if !child}
    <div class="space-y-1.5">
      <span class="block text-sm font-medium">Each run</span>
      <Segmented label="Each run" options={runs} bind:value={run} />
      <p class="note">
        {run === "new" ? "Each run is its own session under this chat, so this conversation stays clean." : "Each run is a turn in this chat."}
      </p>
    </div>
    {#if run === "new"}
      <div class="space-y-1.5">
        <span class="block text-sm font-medium">Tell this chat</span>
        <Segmented label="Tell this chat" options={reports} bind:value={report} />
        <p class="note">{reportHelp[report]}</p>
      </div>
    {/if}
  {/if}
  <p class="note flex items-start gap-2">
    <Icon name="alert" class="h-4 w-4 mt-0.5 shrink-0" /><span
      >Runs while you’re away use this chat’s persona and tools, with this server’s permissions.{schedule ? "" : " It starts switched on."}</span
    >
  </p>
  {#if error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
  <div class="flex gap-2">
    <Button type="submit" variant="primary" loading={saving}>Save</Button>
    <Button onclick={oncancel}>Cancel</Button>
  </div>
</form>

<style>
  .schedule-form {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.875rem 1rem;
  }
  .note {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .number {
    width: 5.5rem;
  }
</style>
