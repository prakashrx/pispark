<script lang="ts">
  /**
   * Settings → Notifications (design set 9/3, G-18): on this device, on or off; what the browser
   * allows; a test; and what to be told. Only when PiSpark isn't open and in view; otherwise the
   * nudge says it inside the app.
   */
  import { onMount } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Card from "../../lib/ui/Card.svelte";
  import CardRow from "../../lib/ui/CardRow.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import type { NotifyEvent } from "../../../../server/src/contract/notification-protocol";
  import { deviceNotifications as n } from "./notifications.svelte";

  onMount(() => void n.load());
  let tested = $state("");
  const EVENTS: { event: NotifyEvent; label: string; hint?: string }[] = [
    { event: "needs-you", label: "A session needs you", hint: "A question or a permission" },
    { event: "failed", label: "A run fails" },
    { event: "finished", label: "A long run finishes", hint: "Over 2 minutes, when you weren’t watching" },
    { event: "schedule-failed", label: "A schedule or routine fails" },
  ];
  const browser = $derived(
    n.support === "home-screen"
      ? "Add PiSpark to your Home Screen, then open it from there"
      : n.support === "no"
        ? "This browser can’t show notifications here"
        : n.permission === "granted"
          ? "✓ Allowed"
          : n.permission === "denied"
            ? "Blocked: allow notifications for this site in the browser’s settings"
            : "Not asked yet",
  );
  async function test() {
    tested = "";
    tested = (await n.test().catch(() => false)) ? "Sent. It shows when PiSpark isn’t in view too." : "Couldn’t send a test.";
  }
</script>

<div class="cards">
  <Card title="This device">
    {#snippet action()}
      {#if n.support === "yes" && n.permission !== "denied"}<Toggle
          label="Notifications on this device"
          checked={n.subscribed}
          disabled={n.busy}
          onchange={(event) => void ((event.currentTarget as HTMLInputElement).checked ? n.enable() : n.disable())}
        />{/if}
    {/snippet}
    <CardRow label="Browser"><span class="value" class:ok={n.permission === "granted" && n.support === "yes"}>{browser}</span></CardRow>
    {#if n.subscribed}<CardRow label="Try it">
        <Button size="compact" onclick={() => void test()}>Send a test</Button>
        <span class="muted small" role="status">{tested}</span>
      </CardRow>{/if}
    {#if n.error}<CardRow><p role="alert" class="danger small">{n.error}</p></CardRow>{/if}
  </Card>

  <Card title="Tell me when">
    {#each EVENTS as { event, label, hint } (event)}
      <CardRow>
        <div class="choice">
          <span class="event"><span>{label}</span>{#if hint}<span class="muted small">{hint}</span>{/if}</span>
          <Toggle label={label} checked={n.events.includes(event)} onchange={(e) => void n.setEvent(event, (e.currentTarget as HTMLInputElement).checked)} />
        </div>
      </CardRow>
    {/each}
    <CardRow>
      <p class="muted small">
        Only when PiSpark isn’t open and in view; otherwise a nudge shows inside the app. Notifications go through your browser’s push service (Apple,
        Google, Microsoft or Mozilla), which learns only that something happened: this device then reads the session’s name and what happened from PiSpark.
      </p>
    </CardRow>
  </Card>
</div>

<style>
  .cards {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    align-items: start;
  }
  .value {
    font-size: var(--text-sm);
  }
  .ok {
    color: var(--success-foreground, var(--foreground));
    font-weight: 500;
  }
  /* What to be told, and its switch at the end of the row (design set 9/3). */
  .choice {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .event {
    flex: 1;
    display: flex;
    flex-direction: column;
    font-size: var(--text-sm);
  }
  .muted {
    color: var(--muted-foreground);
  }
  .small {
    font-size: var(--text-xs);
  }
  .danger {
    color: var(--danger-foreground);
  }
</style>
