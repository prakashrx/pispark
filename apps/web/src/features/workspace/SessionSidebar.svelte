<script lang="ts">
    import Icon from "../../lib/ui/Icon.svelte";
  import { useSessions } from "./session-client.svelte";
  import { chatName, chatStatus } from "./chat-presentation";
  const client = useSessions();

  function groupByDate(sessions: typeof client.sessions) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const today: typeof client.sessions = [];
    const yesterday: typeof client.sessions = [];
    const thisWeek: typeof client.sessions = [];
    const older: typeof client.sessions = [];

    for (const s of sessions) {
      const d = new Date(s.createdAt);
      if (d >= todayStart) today.push(s);
      else if (d >= yesterdayStart) yesterday.push(s);
      else if (d >= weekStart) thisWeek.push(s);
      else older.push(s);
    }

    return [
      { label: "Today", items: today },
      { label: "Yesterday", items: yesterday },
      { label: "This week", items: thisWeek },
      { label: "Older", items: older },
    ].filter(g => g.items.length > 0);
  }

  const groups = $derived(groupByDate(client.sessions));
</script>

<div class="workspace flex-1 min-h-0 flex flex-col justify-between">
  <div class="flex flex-col h-full overflow-hidden">
    <nav aria-label="Chats" class="flex-1 overflow-y-auto px-3 pt-1 pb-3 space-y-3">
      {#if client.sessions.length === 0}
        <p class="px-3 py-3 text-sm text-muted-foreground">No chats yet.</p>
      {:else}
        {#each groups as group}
          <div>
            <p class="px-3 pt-2 pb-1.5 text-xs font-medium text-subtle">{group.label}</p>
            <div class="space-y-px">
              {#each group.items as session (session.id)}
                {@const status = chatStatus(session.status, session.interrupted, session.waiting, session.queued)}
                <a
                  href="#/workspace"
                  onclick={() => client.select(session.id)}
                  aria-current={session.id === client.selected ? "page" : undefined}
                  class="nav-item"
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate">{chatName(session)}</span>
                    {#if session.persona?.name}
                      <span class="block truncate text-xs text-subtle mt-0.5">{session.persona.name}</span>
                    {/if}
                  </span>
                  {#if status}
                    <!-- Shape carries the meaning (spinner vs alert) and the text is announced; color only reinforces it. -->
                    <span class="chat-status" data-tone={status === "Needs attention" ? "warning" : status === "Waiting for you" || status === "Queued" ? "waiting" : "active"} title={status}>
                      {#if status === "Needs attention"}<Icon name="alert" class="h-4 w-4" />{:else if status === "Waiting for you"}<Icon name="help" class="h-4 w-4" />{:else if status === "Queued"}<Icon name="clock" class="h-4 w-4" />{:else}<span class="chat-spinner" aria-hidden="true"></span>{/if}
                      <span class="sr-only">{status}</span>
                    </span>
                  {/if}
                </a>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </nav>
  </div>

  <div class="px-3 py-2.5" style="border-top:1px solid var(--sidebar-border)">
    <a href="#/settings" class="nav-item">
      <Icon name="settings" class="w-[18px] h-[18px] text-muted-foreground" />
      <span>Settings</span>
    </a>
  </div>
</div>

<style>
  .chat-status {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
  }
  .chat-status[data-tone="warning"] {
    color: var(--warning-foreground);
  }
  .chat-status[data-tone="waiting"] {
    color: var(--interactive-text);
  }
  .chat-status[data-tone="active"] {
    color: var(--interactive-text);
  }
  .chat-spinner {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
    border-top-color: currentColor;
    animation: chat-spin 0.9s linear infinite;
  }
  @keyframes chat-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .chat-spinner {
      animation: none;
      border-color: currentColor;
      width: 0.5rem;
      height: 0.5rem;
    }
  }
</style>
