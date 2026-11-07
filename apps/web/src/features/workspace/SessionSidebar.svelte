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
                {@const status = chatStatus(session.status, session.interrupted)}
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
                    <span
                      class="status-pill"
                      data-tone={status === "Needs attention" ? "warning" : "active"}
                      >{status}</span
                    >
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
  .status-pill {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-full);
    font-size: 0.6875rem;
    font-weight: 500;
    white-space: nowrap;
  }
  .status-pill::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .status-pill[data-tone="warning"] {
    background: var(--warning-muted);
    color: var(--warning-foreground);
  }
  .status-pill[data-tone="active"] {
    background: var(--interactive-muted);
    color: var(--interactive-text);
  }
</style>
