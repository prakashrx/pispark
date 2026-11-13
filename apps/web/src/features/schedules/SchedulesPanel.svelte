<script lang="ts">
  import { tick } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import ScheduleCard from "./ScheduleCard.svelte";
  import ScheduleForm from "./ScheduleForm.svelte";
  /** One chat's schedules, inside its Schedules panel: each with its last runs, and Add schedule. */
  let { sessionId }: { sessionId: string } = $props();
  const client = useSessions();
  const schedules = $derived(client.schedules.of(sessionId));
  let adding = $state(false);
  let list = $state<HTMLElement>();
  $effect(() => void client.schedules.refresh().catch(() => {}));
  async function stopAdding() {
    adding = false;
    await tick();
    list?.querySelector<HTMLElement>("[data-add]")?.focus();
  }
</script>

<div class="space-y-3" bind:this={list}>
  {#if client.schedules.paused}<p role="status" class="text-sm text-muted-foreground">
      Unattended runs are paused in Settings → Schedules.
    </p>{/if}
  {#if schedules.length}
    <ul class="space-y-3" aria-label="Schedules">
      {#each schedules as schedule (schedule.id)}<ScheduleCard {schedule} />{/each}
    </ul>
  {:else if !adding}<p class="text-sm text-muted-foreground">
      No schedules yet. Add one, or ask the agent, for example “check again in 30 minutes”.
    </p>{/if}
  {#if adding}
    <ScheduleForm
      oncancel={() => void stopAdding()}
      onsave={async (input) => {
        await client.schedules.add({ ...input, sessionId });
        await stopAdding();
      }}
    />
  {:else}<Button data-add onclick={() => (adding = true)}>Add schedule</Button>{/if}
</div>
