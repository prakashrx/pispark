<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { settingsLinks } from "./navigation";
  import type { Page } from "../../routes";
  import { useSessions } from "../workspace/session-client.svelte";
  const sessions = useSessions();
  let { page }: { page: Page } = $props();
  let query = $state("");
  let personasOpen = $state(true);
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

<div
  class="flex-1 min-h-0 flex flex-col justify-between bg-white text-[#111827]"
>
  <div class="p-3 flex-1 overflow-y-auto">
    <a
      class="inline-flex items-center space-x-1.5 text-xs text-gray-500 hover:text-gray-900 py-2 px-1 mb-2 group transition"
      href="#/workspace"
      ><Icon
        name="back"
        class="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5"
      /><span class="font-normal">Back to workspace</span></a
    >
    <h2 class="text-xs font-semibold text-gray-900 px-1 pt-1 pb-2">Settings</h2>
    <div class="relative mb-3">
      <Input
        label="Search settings"
        bind:value={query}
        density="compact"
        placeholder="Search settings..."
      />
    </div>
    <nav aria-label="Settings Categories" class="space-y-0.5">
      {#each visible as link}
        {#if link.page === "persona"}
          <div class="space-y-0.5">
            <Button
              class="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md transition group"
              aria-expanded={personasOpen}
              onclick={() => {
                personasOpen = !personasOpen;
              }}
            >
              <span class="flex items-center space-x-2"
                ><Icon name="people" class="w-3.5 h-3.5 text-gray-500" /><span
                  class="font-medium">Personas</span
                ></span
              ><Icon
                name={personasOpen ? "settingsChevron" : "chevronRight"}
                class="w-3 h-3 text-gray-400 transition-transform group-hover:text-gray-600"
              />
            </Button>
            {#if personasOpen}
              <div class="pl-5 pr-1 space-y-0.5 border-l border-gray-100 ml-4">
                <a
                  href="#/persona"
                  aria-current={page === "persona" ? "page" : undefined}
                  class="flex items-center px-2 py-1 text-xs font-medium text-gray-900 rounded-md hover:bg-gray-50"
                  onclick={() => sessions.personas.collection()}
                  >Manage personas</a
                >
                {#each sessions.personas.items.slice(0, 16) as persona}<a
                    href="#/persona"
                    class="block px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded-md truncate"
                    onclick={() =>
                      void sessions.personas.open(
                        persona.ref,
                        page !== "persona",
                      )}
                    title={`${persona.ref.root}/${persona.ref.path}`}
                    >{persona.valid
                      ? persona.name
                      : `Needs attention · ${persona.ref.path}`}</a
                  >{/each}
              </div>
            {/if}
          </div>
        {:else}
          {@const active = page === link.page}
          <a
            href={link.page ? "#/" + link.page : undefined}
            aria-disabled={!link.page}
            aria-current={page === link.page ? "page" : undefined}
            title={link.page
              ? undefined
              : "This destination is not included in the supplied screens"}
            class={active
              ? "flex items-center justify-between px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-900 transition " +
                (page === "sources"
                  ? "bg-gray-100/90 shadow-sm"
                  : "bg-gray-100/80")
              : "flex items-center space-x-2 px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md transition"}
          >
            {#if active && page !== "sources"}<span
                class="flex items-center space-x-2"
                ><Icon
                  name={link.icon}
                  class="w-3.5 h-3.5 text-gray-700"
                /><span>{link.label}</span></span
              >
            {:else}<Icon
                name={link.icon}
                class={link.page === "settings"
                  ? "w-3.5 h-3.5 text-gray-700"
                  : "w-3.5 h-3.5 text-gray-400"}
              /><span>{link.label}</span>{/if}
            {#if active}<span class="w-1.5 h-1.5 rounded-full bg-neutral-900"
              ></span>{/if}
          </a>
        {/if}
      {:else}<p class="px-2 py-2 text-xs text-gray-500" role="status">
          No matching settings
        </p>{/each}
    </nav>
  </div>
  <div class="p-3 border-t border-gray-100 mt-auto shrink-0">
    <a
      aria-disabled="true"
      title="Documentation destination is not supplied"
      class="flex items-center space-x-2 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800 transition rounded-md"
      ><Icon name="help" class="w-3.5 h-3.5 text-gray-400" /><span
        >Docs &amp; troubleshooting</span
      ></a
    >
  </div>
</div>
