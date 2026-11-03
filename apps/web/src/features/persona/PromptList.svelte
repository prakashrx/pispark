<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import OrderControls from "./OrderControls.svelte";
  import InstructionFile from "./InstructionFile.svelte";
  import type {
    PersonaInstruction,
    PersonaRef,
  } from "../../../../server/src/persona-protocol";
  import type { PersonaClient } from "./persona-client.svelte";
  let {
    items = $bindable([]),
    reference,
    declared = [],
    readonly = false,
    client,
  }: {
    items: PersonaInstruction[];
    reference: PersonaRef;
    declared?: string[];
    readonly?: boolean;
    client: PersonaClient;
  } = $props();
  function move(from: number, to: number) {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    items = next;
  }
  function add(file = false) {
    let n = 1;
    while (items.some((i) => i.id === `instruction-${n}`)) n++;
    items = [
      ...items,
      file
        ? { id: `instruction-${n}`, file: "rules.md" }
        : { id: `instruction-${n}`, text: "" },
    ];
  }
</script>

<Section
  title="Instructions"
  description="Tell the persona how to respond. Instructions are followed in this order."
  class="space-y-3 pt-2"
>
  {#each items as item, index (item)}
    <div
      class="border border-gray-200 rounded-xl p-4 bg-white shadow-sm space-y-3"
    >
      <div class="flex justify-between items-center gap-2 flex-wrap">
        <span class="text-xs">Instruction {index + 1}</span>
        <OrderControls
          {index}
          count={items.length}
          label={`instruction ${index + 1}`}
          {move}
          remove={() => (items = items.filter((_, i) => i !== index))}
          disabled={readonly}
        />
      </div>
      {#if item.file !== undefined}
        <label class="block text-xs space-y-1"
          >File
          <Input
            label={`File · instruction ${index + 1}`}
            class="source-input"
            bind:value={item.file}
            disabled={readonly}
          /></label
        >
        {#key `${reference.id}/${item.file}`}<InstructionFile
            {reference}
            path={item.file}
            {readonly}
            declared={declared.includes(item.file)}
            {client}
          />{/key}
      {:else}
        <Textarea
          label={`Instruction ${index + 1} text`}
          class="source-input"
          rows={4}
          bind:value={item.text}
          disabled={readonly}
        />
      {/if}
      <details class="text-xs space-y-2">
        <summary>Advanced</summary><label class="block"
          >Reference name <Input
            label={`Instruction ${index + 1} reference name`}
            class="source-input max-w-xs"
            bind:value={item.id}
            disabled={readonly}
            maxlength={64}
          />
        </label>
        <label class="text-xs flex items-center gap-2"
          ><input
            type="checkbox"
            checked={item.replace === true}
            disabled={readonly}
            onchange={(event) => {
              if (event.currentTarget.checked) item.replace = true;
              else delete item.replace;
            }}
          />Replace matching instruction</label
        >
      </details>
    </div>
  {/each}
  {#if !items.length}<p class="text-xs text-neutral-500">
      No instructions added here.
    </p>{/if}
  <div class="flex gap-2 flex-wrap">
    <Button
      class="persona-add"
      disabled={readonly || items.length >= 32}
      onclick={() => add()}>Add instruction</Button
    ><Button
      class="persona-add"
      disabled={readonly || items.length >= 32}
      onclick={() => add(true)}>Use a file</Button
    >
  </div>
</Section>
