<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { useSessions } from "./session-client.svelte";
  import { chatName, chatStatus, chatStarted } from "./chat-presentation";
  const client = useSessions();
  let collapsed = $state(false);
</script>

<div class="workspace flex-1 min-h-0 flex flex-col justify-between">
  <div class="flex flex-col h-full overflow-hidden">
    <div class="p-3"></div>
    <div class="flex-1 overflow-y-auto px-2 space-y-4 py-1 text-xs">
      <div>
        <Button
          class="w-full flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider"
          aria-expanded={!collapsed}
          onclick={() => (collapsed = !collapsed)}
        >
          <span>Chats</span><span>{client.sessions.length}</span>
        </Button>
        {#if !collapsed}
          <div class="space-y-0.5 mt-0.5">
            {#each client.sessions as session (session.id)}
              <a
                href="#/workspace"
                onclick={() => client.select(session.id)}
                aria-current={session.id === client.selected
                  ? "page"
                  : undefined}
                class={session.id === client.selected
                  ? "group flex items-start justify-between px-2.5 py-2 rounded-lg bg-zinc-200/70 text-zinc-900 font-medium transition-colors border border-zinc-300/40"
                  : "group flex items-start justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-200/40 text-zinc-700 transition-colors"}
              >
                <div class="min-w-0 pr-2">
                  <div class="truncate text-xs font-semibold">
                    {chatName(session)}
                  </div>
                  <div class="text-[11px] text-zinc-500 truncate">
                    {[
                      session.persona?.name,
                      client.catalog.workspaces.find(
                        (w) => w.value === session.workspace,
                      )?.label ?? session.workspace,
                      chatStarted(session),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <span
                  class="text-[10px] text-zinc-500 font-mono flex-shrink-0 mt-0.5"
                  >{chatStatus(session.status, session.interrupted)}</span
                >
              </a>
            {:else}<p class="px-2.5 py-2 text-zinc-500">No chats yet.</p>{/each}
          </div>
        {/if}
      </div>
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
