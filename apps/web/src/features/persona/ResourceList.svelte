<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Symbol from "../../lib/ui/Symbol.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import type { PersonaResource } from "./fixtures";
  let {
    title,
    description,
    singular,
    items = $bindable([]),
  }: {
    title: string;
    description: string;
    singular: string;
    items: PersonaResource[];
  } = $props();
</script>

<Section {title} {description} class="space-y-3 pt-4 border-t border-gray-100">
  <div
    class="border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white shadow-sm overflow-hidden"
  >
    {#each items as item (item.name)}
      <div
        class="p-3.5 flex items-center justify-between hover:bg-gray-50/60 transition"
      >
        <div class="flex items-center space-x-3 min-w-0">
          <div
            class="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-700 shrink-0"
          >
            <Symbol name={item.icon} class="text-base" />
          </div>
          <div>
            <div class="flex items-center space-x-2 flex-wrap">
              <span class="text-xs font-mono font-bold text-neutral-900"
                >{item.name}</span
              >
              {#if item.tag}<span
                  class="text-[10px] font-mono bg-neutral-100 text-neutral-600 px-1.5 py-0.2 rounded"
                  >{item.tag}</span
                >{/if}
              <span class="text-[10px] text-neutral-400 font-mono"
                >source: {item.source}</span
              >
            </div>
            <p class="text-xs text-neutral-500 mt-0.5">{item.description}</p>
          </div>
        </div>
        <Button
          class="text-neutral-400 hover:text-red-700 transition p-1 rounded"
          aria-label={`Remove ${item.name} from local draft`}
          title="Remove"
          onclick={() => {
            items = items.filter((value) => value.name !== item.name);
          }}><Symbol name="close" class="text-base" /></Button
        >
      </div>
    {/each}
  </div>
  <div class="pt-1">
    <Button
      class="persona-add"
      unavailable="Resource selection requires a backend catalog"
      ><Symbol name="add" class="text-sm" /><span>Add {singular}</span></Button
    >
  </div>
</Section>
