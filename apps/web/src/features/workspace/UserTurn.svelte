<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  import { reportBody, type Turn } from "./chat-turns";
  import { useSessions } from "./session-client.svelte";
  /**
   * Your message, or (`woken`) one something else sent, labelled as such. One another session sent
   * (`from`: its report, or a parent's message to its child) is not yours, so it is not your bubble.
   */
  let { text, woken, from }: { text: string; woken?: string; from?: Turn["from"] } = $props();
  const client = useSessions();
  // The label is "‹title› · finished": the title is what links to the session.
  const cut = $derived(from ? from.label.indexOf(" · ") : -1);
  const title = $derived(from ? (cut >= 0 ? from.label.slice(0, cut) : from.label) : "");
  const rest = $derived(from && cut >= 0 ? from.label.slice(cut) : "");
  const known = $derived(from?.kind === "session" && client.sessions.some((session) => session.id === from.id));
</script>

{#if from}
  <div class="flex flex-col items-start gap-1.5" data-purpose="session-turn">
    <p class="woken">
      <Icon name={from.kind === "process" ? "terminal" : "sessionBack"} class="h-3.5 w-3.5" /><span
        >From {#if known}<button type="button" class="link" onclick={() => client.select(from.id)}>{title}</button>{:else}{title}{/if}{rest}</span
      >
    </p>
    <div class="report" class:output={from.kind === "process"}>{reportBody(text)}</div>
  </div>
{:else}
  <div class="flex flex-col items-end gap-1.5" data-purpose="user-turn">
    {#if woken}<p class="woken"><Icon name="clock" class="h-3.5 w-3.5" /><span>{woken}</span></p>{/if}
    <div class="user-bubble">
      {text}
    </div>
  </div>
{/if}

<style>
  .user-bubble,
  .report {
    max-width: min(36rem, 80%);
    padding: 0.625rem 1.125rem;
    border-radius: var(--radius-xl);
    font-family: var(--font-reading);
    font-size: 1rem;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--foreground);
  }
  .user-bubble {
    background: var(--bubble);
  }
  .report {
    max-width: min(36rem, 90%);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .report.output {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
    line-height: 1.55;
  }
  .woken {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
