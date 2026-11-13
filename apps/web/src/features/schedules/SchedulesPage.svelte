<script lang="ts">
  import SettingsPage from "../../lib/ui/SettingsPage.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import FieldRow from "../../lib/ui/FieldRow.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import ScheduleCard from "./ScheduleCard.svelte";
  /** Settings → Schedules: the one place that shows every schedule, and Pause all. */
  const client = useSessions();
  const schedules = client.schedules;
  let error = $state("");
  $effect(() => void schedules.refresh().catch(() => (error = "Couldn’t load the schedules.")));
  async function pause(paused: boolean) {
    error = "";
    try {
      await client.saveSettings({ schedulesPaused: paused });
    } catch {
      error = "Couldn’t save. Try again.";
    }
    await schedules.refresh().catch(() => {});
  }
</script>

<SettingsPage
  title="Schedules"
  description="Every schedule in your chats. Each run is a turn in its chat, with that chat’s persona and tools."
  label="Schedules settings"
>
  <Section title="Pause all" description="Nothing runs while paused. Runs that come due are recorded as missed.">
    <div class="settings-card mt-4">
      <FieldRow label="Pause all schedules" description={schedules.paused ? "Paused: no schedule runs." : "Schedules run at their times."}>
        <Toggle
          label="Pause all schedules"
          checked={schedules.paused}
          onchange={(event) => void pause((event.currentTarget as HTMLInputElement).checked)}
        />
      </FieldRow>
    </div>
  </Section>
  <Section title="Schedules" description="Add one from a chat’s info (Chat info → Schedules), or ask the agent in a chat.">
    {#if error}<p role="alert" class="mt-4 text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
    {#if schedules.schedules.length}
      <ul class="mt-4 space-y-3" aria-label="All schedules">
        {#each schedules.schedules as schedule (schedule.id)}<ScheduleCard {schedule} withSession />{/each}
      </ul>
    {:else if schedules.loaded}<p class="mt-4 text-sm text-muted-foreground">No schedules yet.</p>
    {:else}<p role="status" class="mt-4 text-sm text-muted-foreground">Loading…</p>{/if}
  </Section>
</SettingsPage>
