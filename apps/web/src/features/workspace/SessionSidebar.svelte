<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { sessionGroups } from "./fixtures";
  let collapsedGroups = $state<string[]>(["October 28"]);
  function toggle(day: string) {
    collapsedGroups = collapsedGroups.includes(day)
      ? collapsedGroups.filter((value) => value !== day)
      : [...collapsedGroups, day];
  }
</script>

<div class="workspace flex-1 min-h-0 flex flex-col justify-between">
  <div class="flex flex-col h-full overflow-hidden">
    <div class="p-3"></div>
    <div class="flex-1 overflow-y-auto px-2 space-y-4 py-1 text-xs">
      {#each sessionGroups as group}
        <div>
          <Button
            class="w-full flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider"
            aria-label={group.day}
            aria-expanded={!collapsedGroups.includes(group.day)}
            onclick={() => toggle(group.day)}
          >
            <span class="flex items-center gap-1.5"
              >{#if collapsedGroups.includes(group.day)}<Icon
                  name="chevronRight"
                  class="w-3 h-3 text-zinc-400"
                />{/if}{group.day}</span
            >
            <span class="text-[10px] text-zinc-400 font-mono"
              >{group.sessions.length}</span
            >
          </Button>
          {#if !collapsedGroups.includes(group.day)}
            <div class="space-y-0.5 mt-0.5">
              {#each group.sessions as session}
                <a
                  href={session.active ? "#/workspace" : undefined}
                  aria-current={session.active ? "page" : undefined}
                  aria-disabled={!session.active}
                  title={session.active
                    ? undefined
                    : "Only Workspace review has a supplied conversation"}
                  class={session.active
                    ? "group flex items-start justify-between px-2.5 py-2 rounded-lg bg-zinc-200/70 text-zinc-900 font-medium transition-colors border border-zinc-300/40"
                    : "group flex items-start justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-200/40 text-zinc-700 transition-colors"}
                >
                  <div class="min-w-0 pr-2">
                    <div
                      class={session.active
                        ? "truncate text-xs font-semibold"
                        : "truncate text-xs font-medium group-hover:text-zinc-900"}
                    >
                      {session.title}
                    </div>
                    <div
                      class={session.active
                        ? "text-[11px] text-zinc-500 font-mono truncate"
                        : "text-[11px] text-zinc-400 font-mono truncate"}
                    >
                      {session.folder}
                    </div>
                  </div>
                  <span
                    class={session.active
                      ? "text-[10px] text-zinc-500 font-mono flex-shrink-0 mt-0.5"
                      : "text-[10px] text-zinc-400 font-mono flex-shrink-0 mt-0.5"}
                    >{session.time}</span
                  >
                </a>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  <div class="p-2 border-t border-zinc-200/70 space-y-0.5 bg-[#fbfbfb]">
    <Button
      unavailable="Archived sessions are not included in the supplied screens"
      class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 hover:text-zinc-900 rounded-lg hover:bg-zinc-200/50 transition-colors"
      ><Icon name="archive" class="w-4 h-4 text-zinc-500" /><span>Archived</span
      ></Button
    >
    <a
      href="#/settings"
      class="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-600 hover:text-zinc-900 rounded-lg hover:bg-zinc-200/50 transition-colors"
      ><Icon name="settings" class="w-4 h-4 text-zinc-500" /><span
        >Settings</span
      ></a
    >
  </div>
</div>
