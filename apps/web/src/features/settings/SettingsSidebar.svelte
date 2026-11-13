<script lang="ts">
  import Input from "../../lib/ui/Input.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { settingsLinks } from "./navigation";
  import type { Page } from "../../routes";
  import { useSessions } from "../workspace/session-client.svelte";
  const sessions = useSessions();
  let { page }: { page: Page } = $props();
  let query = $state("");
  const visible = $derived(
    settingsLinks.filter((link) =>
      (
        link.label +
        (link.page === "persona"
          ? sessions.personas.items.map((p) => p.name).join(" ")
          : "")
      )
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
  );
</script>

<div class="flex-1 min-h-0 flex flex-col">
  <div class="px-3 pt-1 pb-3 flex-1 overflow-y-auto">
    <a class="nav-item group text-muted-foreground" href="#/workspace"
      ><Icon
        name="back"
        class="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
      /><span>Back to chats</span></a
    >
    <h2 class="px-3 pt-4 pb-2 text-xs font-medium text-subtle">Settings</h2>
    <div class="px-1 pb-2">
      <Input
        label="Search settings"
        bind:value={query}
        placeholder="Search settings…"
      />
    </div>
    <nav aria-label="Settings Categories" class="space-y-px">
      {#each visible as link}
        {#if link.page}
          <a
            href={"#/" + link.page}
            aria-current={page === link.page ? "page" : undefined}
            class="nav-item"
            onclick={() => {
              if (link.page === "persona") sessions.personas.collection();
            }}
          >
            <Icon name={link.icon} class="w-[18px] h-[18px] text-muted-foreground" />
            <span class="flex-1">{link.label}</span>
            {#if link.page === "persona" && sessions.personas.items.length}<span
                class="text-xs text-subtle">{sessions.personas.items.length}</span
              >{:else if link.page === "schedules" && sessions.schedules.schedules.length}<span
                class="text-xs text-subtle">{sessions.schedules.schedules.length}</span
              >{/if}
          </a>
          {#if link.page === "persona" && page === "persona" && sessions.personas.items.length}
            <div class="ml-[1.375rem] pl-3 my-1 border-l border-[var(--sidebar-border)] space-y-px">
              <a
                href="#/persona"
                class="nav-item !min-h-0 !py-1.5 text-[0.8125rem]"
                onclick={() => sessions.personas.collection()}>Manage personas</a
              >
              {#each sessions.personas.items.slice(0, 16) as persona}<a
                  href="#/persona"
                  class="nav-item !min-h-0 !py-1.5 text-[0.8125rem] text-muted-foreground"
                  onclick={() => void sessions.personas.open({ persona: persona.id })}
                  title={`personas/${persona.id}`}
                  ><span class="truncate flex-1"
                    >{persona.name}</span
                  >{#if !persona.valid}<span class="needs-attention" title="Needs attention"
                      ><Icon name="alert" class="h-4 w-4" /><span class="sr-only">Needs attention</span></span
                    >{/if}</a
                >{/each}
            </div>
          {/if}
        {:else}
          <a
            aria-disabled="true"
            title="Not available yet"
            class="nav-item"
          >
            <Icon name={link.icon} class="w-[18px] h-[18px]" />
            <span class="flex-1">{link.label}</span>
            <span class="soon">Soon</span>
          </a>
        {/if}
      {:else}<p class="px-3 py-2 text-sm text-muted-foreground" role="status">
          No matching settings
        </p>{/each}
    </nav>
  </div>
</div>

<style>
  .soon {
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    color: var(--subtle-foreground);
  }
  .needs-attention {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    color: var(--warning-foreground);
  }
</style>
