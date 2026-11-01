<script lang="ts">
  import { onDestroy } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Symbol from "../../lib/ui/Symbol.svelte";
  import SourceCard from "./SourceCard.svelte";
  import AddSourceModal from "./AddSourceModal.svelte";
  import { sources, type SourceDraft } from "./fixtures";
  let localSources = $state(structuredClone(sources));
  let adding = $state(false);
  let notice = $state("");
  let timer: ReturnType<typeof setTimeout>;
  let nextId = 1;
  function notify(message: string) {
    notice = message;
    clearTimeout(timer);
    timer = setTimeout(() => {
      notice = "";
    }, 3500);
  }
  onDestroy(() => clearTimeout(timer));
  function add(draft: SourceDraft) {
    localSources = [
      ...localSources,
      {
        id: `draft-${nextId++}`,
        name: draft.name,
        kind: draft.kind === "git" ? "Git Repository" : "Marketplace",
        location: draft.location,
        detail: "Local draft",
        branch: draft.kind === "git" ? draft.branch : undefined,
        resources: [],
        updated: draft.autoUpdate
          ? "Auto-sync: On launch (draft)"
          : "Auto-sync: Off (draft)",
        status: "Draft",
      },
    ];
    adding = false;
    notify("Added local draft; no source connected");
  }
  function remove(id: string, name: string) {
    if (
      window.confirm(
        `Remove source "${name}" from this local draft? No backend configuration will change.`,
      )
    ) {
      localSources = localSources.filter((source) => source.id !== id);
      notify("Removed from local draft only");
    }
  }
</script>

<main
  id="workspace"
  class="flex-1 overflow-y-auto px-8 py-8 bg-[#ffffff]"
  aria-label="Fixture sources; no external connections"
>
  <div class="flex flex-col w-full max-w-5xl mx-auto space-y-8">
    <div
      class="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2"
    >
      <div>
        <h1
          class="text-xl font-semibold text-gray-900 tracking-tight flex items-center gap-2.5"
        >
          Sources <span
            class="text-[11px] font-mono font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full"
            >{localSources.filter((source) => source.status === "Active")
              .length} active</span
          >
        </h1>
        <p class="text-xs text-gray-500 mt-1 max-w-xl">
          Marketplaces and Git repositories that provide skills, extensions, and
          commands for your personas.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg shadow-sm transition active:scale-[0.98]"
          unavailable="Source synchronization requires the backend"
          ><Symbol
            name="sync"
            class="text-[16px] text-gray-500 transition-transform duration-500"
          /><span>Sync all</span></Button
        ><Button
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg shadow-sm transition active:scale-[0.98]"
          onclick={() => {
            adding = true;
          }}
          ><Symbol name="add" class="text-[16px]" /><span>Add Source</span
          ></Button
        >
      </div>
    </div>
    <div class="space-y-3">
      {#each localSources as source (source.id)}
        <SourceCard
          {source}
          onremove={() => remove(source.id, source.name)}
          ontoggle={() => {
            source.status =
              source.status === "Disabled"
                ? source.id.startsWith("draft-")
                  ? "Draft"
                  : "Active"
                : "Disabled";
            notify("Changed local draft only; no source connection changed");
          }}
        />
      {/each}
    </div>
    <div class="bg-gray-50/80 rounded-xl p-4 flex items-start gap-3 shadow-sm">
      <Symbol name="lightbulb" class="text-gray-400 text-[18px] mt-0.5" />
      <div class="text-xs text-gray-600 space-y-1">
        <p class="font-medium text-gray-800">Persona Resource Resolution</p>
        <p
          class="text-gray-500 leading-relaxed"
          title="Ordering is fixture-only; drag reordering is not implemented"
        >
          When multiple sources declare the same command or prompt, priority
          follows top-to-bottom order. Drag to reorder, or scope resources
          within a specific persona's settings.
        </p>
      </div>
    </div>
  </div>
</main>
{#if adding}<AddSourceModal
    names={localSources.map((source) => source.name)}
    onclose={() => {
      adding = false;
    }}
    onadd={add}
  />{/if}
{#if notice}<div
    role="status"
    class="fixed bottom-6 right-6 z-50 bg-neutral-900 text-white text-xs font-medium px-3.5 py-2 rounded-lg shadow-lg flex items-center gap-2 max-w-[calc(100%-3rem)]"
  >
    <Symbol name="check_circle" class="text-[16px] text-emerald-400" /><span
      >{notice}</span
    >
  </div>{/if}
