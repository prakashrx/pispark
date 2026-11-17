<script lang="ts">
  import Icon from "../../../lib/ui/Icon.svelte";
  import { useSessions } from "../session-client.svelte";
  import { sessionName, sessionStatus } from "../session-presentation";
  import type { Segment } from "../session-turns";
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

<!-- A quiet line (design set 3/2): name · state, opening the session. -->
<div class="started">
  {#if session}<button type="button" class="open" onclick={() => client.open(session.id)}>
      <Icon name="sessionOut" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span class="min-w-0 truncate"><span class="sr-only">Open </span>{sessionName(session)}</span>
      <span class="state">· {shown}</span>
      <Icon name="chevronRight" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  {:else}
    <Icon name="sessionOut" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    <span class="min-w-0 truncate">{segment.title}</span>
    <span class="state">· {shown}</span>
  {/if}
</div>

<style>
  .started {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 1.75rem;
    min-width: 0;
    font-size: var(--text-sm);
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    padding: 0.125rem 0.25rem 0.125rem 0;
    border-radius: var(--radius-sm);
    color: var(--foreground);
  }
  .open:hover {
    background: var(--accent);
  }
  .state {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>
