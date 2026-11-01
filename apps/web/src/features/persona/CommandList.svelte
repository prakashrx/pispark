<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Symbol from "../../lib/ui/Symbol.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import type { PersonaPrompt } from "./fixtures";
  let { items = $bindable([]) }: { items: PersonaPrompt[] } = $props();
  let editing = $state<number | null>(null);
</script>

<Section
  title="Commands"
  description="Custom slash commands mapped to prompt text or prompt files"
  class="space-y-3 pt-4 border-t border-gray-100"
>
  <div
    class="border border-gray-200 rounded-xl divide-y divide-gray-100 bg-white shadow-sm overflow-hidden"
  >
    {#each items as item (item.id)}
      <div
        class="p-3.5 flex items-center justify-between hover:bg-gray-50/60 transition"
      >
        <div class="space-y-1 flex-1 min-w-0">
          <div class="flex items-center space-x-2">
            <span
              class="font-mono text-xs font-bold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded"
              >{item.name}</span
            ><span
              class="text-[10px] font-medium bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full"
              >{item.kind}</span
            >
          </div>
          {#if editing === item.id}<Textarea
              label={`${item.name} local draft`}
              bind:value={item.content}
              rows={2}
              class="w-full text-xs font-mono border-gray-200 rounded-lg"
            />
          {:else if item.kind === "Text"}<p class="text-xs text-neutral-600">
              {item.content}
            </p>
          {:else}<div
              class="flex items-center space-x-1.5 text-xs text-neutral-600 font-mono"
            >
              <Symbol
                name="description"
                class="text-sm text-neutral-400"
              /><span>{item.content}</span>
            </div>{/if}
        </div>
        <div class="flex items-center space-x-1">
          <Button
            class="text-neutral-400 hover:text-neutral-700 p-1 rounded"
            aria-label={`Edit ${item.name}`}
            aria-pressed={editing === item.id}
            title="Edit"
            onclick={() => {
              editing = editing === item.id ? null : item.id;
            }}><Symbol name="edit" class="text-base" /></Button
          >
          <Button
            class="text-neutral-400 hover:text-red-700 p-1 rounded"
            aria-label={`Remove ${item.name} from local draft`}
            title="Remove"
            onclick={() => {
              items = items.filter((value) => value.id !== item.id);
            }}><Symbol name="close" class="text-base" /></Button
          >
        </div>
      </div>
    {/each}
  </div>
  <div class="pt-1">
    <Button
      class="persona-add"
      unavailable="Command creation form is not included in the supplied screens"
      ><Symbol name="add" class="text-sm" /><span>Add Command</span></Button
    >
  </div>
</Section>
