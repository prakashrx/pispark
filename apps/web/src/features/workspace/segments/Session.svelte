<script lang="ts">
  import Icon from "../../../lib/ui/Icon.svelte";
  import { useSessions } from "../session-client.svelte";
  import { sessionName, sessionStatus } from "../session-presentation";
  import type { Segment } from "../chat-turns";
  // A session this one started: its name and live state, and a way to open it.
  let { segment }: { segment: Extract<Segment, { kind: "session" }> } = $props();
  const client = useSessions();
  const session = $derived(client.sessions.find((s) => s.id === segment.sessionId));
  // Just started, it may not be in the list yet: look once, rather than wait for the next refresh.
  let looked = $state(false);
  $effect(() => {
    if (session || looked) return;
    void client
      .refresh()
      .catch(() => {})
      .finally(() => (looked = true));
  });
  const shown = $derived(!session ? (looked ? "Archived" : "Starting…") : sessionStatus(session) || "Finished");
</script>

<div class="started">
  <Icon name="sessionOut" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  <span class="min-w-0 flex-1 truncate">{session ? sessionName(session) : segment.title}</span>
  <span class="text-xs text-muted-foreground">{shown}</span>
  {#if session}<button type="button" class="open" onclick={() => client.select(session.id)}
      >Open<span class="sr-only"> {sessionName(session)}</span></button
    >{/if}
</div>

<style>
  .started {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 0.875rem;
  }
  .open {
    font-size: 0.875rem;
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
