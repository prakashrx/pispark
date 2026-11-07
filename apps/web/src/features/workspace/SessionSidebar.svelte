<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
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

    <!-- New Chat button -->
    <div class="p-2 pt-3 pb-2 border-b border-zinc-100">
      <Button
        class="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-700 hover:text-zinc-900 rounded-lg hover:bg-zinc-200/50 transition-colors"
        onclick={() => client.select("")}
      >
        <Icon name="plus" class="w-3.5 h-3.5 text-zinc-500" />
        <span>New chat</span>
      </Button>
    </div>

    <!-- Session list with date groups -->
    <div class="flex-1 overflow-y-auto px-2 py-2 space-y-3 text-xs">
      {#if client.sessions.length === 0}
        <p class="px-2.5 py-3 text-zinc-400 text-xs">No chats yet.</p>
      {:else}
        {#each groups as group}
          <div>
            <p class="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{group.label}</p>
            <div class="space-y-0.5">
              {#each group.items as session (session.id)}
                <a
                  href="#/workspace"
                  onclick={() => client.select(session.id)}
                  aria-current={session.id === client.selected ? "page" : undefined}
                  class={session.id === client.selected
                    ? "group flex items-start justify-between px-2.5 py-2 rounded-lg bg-zinc-200/70 text-zinc-900 font-medium transition-colors border border-zinc-300/40"
                    : "group flex items-start justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-200/40 text-zinc-700 transition-colors"}
                >
                  <div class="min-w-0 pr-2">
                    <div class="truncate text-xs font-semibold">
                      {chatName(session)}
                    </div>
                    {#if session.persona?.name}
                      <div class="text-[11px] text-zinc-500 truncate">{session.persona.name}</div>
                    {/if}
                  </div>
                  <span class="text-[10px] text-zinc-500 font-mono flex-shrink-0 mt-0.5"
                    >{chatStatus(session.status, session.interrupted)}</span
                  >
                </a>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <div class="p-2 border-t border-zinc-200/70 space-y-0.5 bg-[#fbfbfb]">
    <a
      href="#/settings"
      class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 hover:text-zinc-900 rounded-lg hover:bg-zinc-200/50 transition-colors"
      ><Icon name="settings" class="w-4 h-4 text-zinc-500" /><span
        >Settings</span
      ></a
    >
  </div>
</div>
