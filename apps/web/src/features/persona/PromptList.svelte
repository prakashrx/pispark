<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Symbol from "../../lib/ui/Symbol.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import type { PersonaPrompt } from "./fixtures";
  let { items = $bindable([]) }: { items: PersonaPrompt[] } = $props();
  let nextId = 3;
</script>

<Section
  title="Prompts"
  description="Set base system instructions either by typing directly or attaching a local file"
  class="space-y-3 pt-2"
>
  <div class="space-y-3">
    {#each items as item (item.id)}
      <div
        class={item.kind === "Text"
          ? "border border-gray-200 rounded-xl p-4 bg-white shadow-sm space-y-3"
          : "border border-gray-200 rounded-xl p-4 bg-white shadow-sm flex items-center justify-between"}
      >
        {#if item.kind === "Text"}
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <span class="text-xs font-semibold text-neutral-800"
                >{item.name}</span
              ><span
                class="text-[10px] font-medium bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full"
                >Text</span
              >
            </div>
            <Button
              class="text-neutral-400 hover:text-red-700 transition p-1 rounded"
              aria-label={`Remove ${item.name} from local draft`}
              title="Remove"
              onclick={() => {
                items = items.filter((value) => value.id !== item.id);
              }}><Symbol name="delete" class="text-base" /></Button
            >
          </div>
          <Textarea
            label={item.name}
            class="w-full text-xs font-mono bg-neutral-50 border border-gray-200 rounded-lg p-2.5 text-neutral-800 focus:outline-none focus:bg-white focus:ring-1 focus:ring-neutral-400 transition leading-relaxed resize-none"
            rows={3}
            bind:value={item.content}
          />
        {:else}
          <div class="space-y-1">
            <div class="flex items-center space-x-2">
              <span class="text-xs font-semibold text-neutral-800"
                >{item.name}</span
              ><span
                class="text-[10px] font-medium bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full"
                >File</span
              >
            </div>
            <div
              class="flex items-center space-x-1.5 text-xs text-neutral-600 font-mono"
            >
              <Symbol
                name="description"
                class="text-sm text-neutral-400"
              /><span>{item.content}</span>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <Button
              class="text-xs text-neutral-700 hover:text-neutral-900 border border-gray-200 hover:border-gray-300 px-2.5 py-1.5 rounded-lg transition font-medium bg-white"
              unavailable="File selection must resolve on the backend machine"
              >Change file</Button
            ><Button
              class="text-neutral-400 hover:text-red-700 transition p-1 rounded"
              aria-label={`Remove ${item.name} from local draft`}
              title="Remove"
              onclick={() => {
                items = items.filter((value) => value.id !== item.id);
              }}><Symbol name="delete" class="text-base" /></Button
            >
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <div class="flex items-center space-x-2 pt-1">
    <Button
      class="persona-add"
      onclick={() => {
        items = [
          ...items,
          { id: nextId++, name: "Text Prompt", kind: "Text", content: "" },
        ];
      }}
      ><Symbol name="add" class="text-sm" /><span>Add Text Prompt</span></Button
    >
    <Button
      class="persona-add"
      unavailable="File selection must resolve on the backend machine"
      ><Symbol name="attach_file" class="text-sm" /><span>Add File Prompt</span
      ></Button
    >
  </div>
</Section>
