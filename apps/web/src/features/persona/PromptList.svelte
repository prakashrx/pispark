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
  title="System instructions"
  description="Ordered text or UTF-8 .md/.txt references on the backend host. Replacements retain their inherited position."
  class="space-y-3 pt-2"
>
  {#each items as item, index (item)}
    <div
      class="border border-gray-200 rounded-xl p-4 bg-white shadow-sm space-y-3"
    >
      <div class="flex justify-between items-center gap-2 flex-wrap">
        <Input
          label={`Instruction ${index + 1} ID`}
          class="source-input max-w-xs"
          bind:value={item.id}
          disabled={readonly}
          maxlength={64}
        />
        <OrderControls
          {index}
          count={items.length}
          label={`instruction ${index + 1}`}
          {move}
          remove={() => (items = items.filter((_, i) => i !== index))}
          disabled={readonly}
        />
      </div>
      <label class="text-xs flex items-center gap-2"
        ><input
          type="checkbox"
          checked={item.replace === true}
          disabled={readonly}
          onchange={(event) => {
            if (event.currentTarget.checked) item.replace = true;
            else delete item.replace;
          }}
        />Replace inherited ID</label
      >
      {#if item.file !== undefined}
        <Input
          label={`Instruction ${index + 1} relative file`}
          class="source-input"
          bind:value={item.file}
          disabled={readonly}
        />
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
    </div>
  {/each}
  {#if !items.length}<p class="text-xs text-neutral-500">
      No local instructions.
    </p>{/if}
  <div class="flex gap-2 flex-wrap">
    <Button
      class="persona-add"
      disabled={readonly || items.length >= 32}
      onclick={() => add()}>Add text instruction</Button
    ><Button
      class="persona-add"
      disabled={readonly || items.length >= 32}
      onclick={() => add(true)}>Add file instruction</Button
    >
  </div>
</Section>
