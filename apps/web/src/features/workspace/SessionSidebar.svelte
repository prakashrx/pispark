<script lang="ts">
  import Icon from "../../lib/ui/Icon.svelte";
  import AppEntry from "./AppEntry.svelte";
  import SessionMark from "./SessionMark.svelte";
  import { useSessions } from "./session-client.svelte";
  import { chatName, sessionStatus } from "./chat-presentation";
  const client = useSessions();
  // App personas are opened from their own section, and their sessions are listed there.
  const apps = $derived(client.personas.items.filter((persona) => persona.valid && persona.home));
  const chats = $derived(client.sessions.filter((session) => !session.persona?.home));

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

  const groups = $derived(groupByDate(chats));
</script>

<div class="workspace flex-1 min-h-0 flex flex-col justify-between">
  <div class="flex flex-col h-full overflow-hidden">
    <div class="flex-1 overflow-y-auto px-3 pt-1 pb-3 space-y-3">
      {#if apps.length}
        <nav aria-label="Apps">
          <p class="px-3 pt-2 pb-1.5 text-xs font-medium text-subtle">Apps</p>
          <div class="space-y-px">
            {#each apps as app (app.id)}<AppEntry {app} />{/each}
          </div>
        </nav>
      {/if}
      <nav aria-label="Chats" class="space-y-3">
        {#if chats.length === 0}
          <p class="px-3 py-3 text-sm text-muted-foreground">No chats yet.</p>
        {:else}
          {#each groups as group}
            <div>
              <p class="px-3 pt-2 pb-1.5 text-xs font-medium text-subtle">{group.label}</p>
              <div class="space-y-px">
                {#each group.items as session (session.id)}
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
                    <SessionMark status={sessionStatus(session)} />
                  </a>
                {/each}
              </div>
            </div>
          {/each}
        {/if}
      </nav>
    </div>
  </div>

  <div class="px-3 py-2.5" style="border-top:1px solid var(--sidebar-border)">
    <a href="#/settings" class="nav-item">
      <Icon name="settings" class="w-[18px] h-[18px] text-muted-foreground" />
      <span>Settings</span>
    </a>
  </div>
</div>
