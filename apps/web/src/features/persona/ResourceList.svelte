<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import OrderControls from "./OrderControls.svelte";
  import type { PersonaSkill } from "../../../../server/src/persona-protocol";
  let {
    items = $bindable([]),
    readonly = false,
  }: { items: PersonaSkill[]; readonly?: boolean } = $props();
  function move(from: number, to: number) {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    items = next;
  }
</script>

<Section
  title="Skills"
  description="Reference existing standard skill directories containing SKILL.md and supporting files. No tools are granted by selecting skills."
  class="space-y-3 pt-4 border-t border-gray-100"
>
  {#each items as item, index (item)}<div
      class="p-4 border border-gray-200 rounded-xl space-y-3"
    >
      <div class="flex gap-2 items-center flex-wrap">
        <Input
          label={`Skill ${index + 1} ID`}
          class="source-input max-w-xs"
          bind:value={item.id}
          disabled={readonly}
        /><OrderControls
          {index}
          count={items.length}
          label={`skill ${index + 1}`}
          {move}
          remove={() => (items = items.filter((_, i) => i !== index))}
          disabled={readonly}
        />
      </div>
      <Input
        label={`Skill ${index + 1} relative directory`}
        class="source-input"
        bind:value={item.directory}
        disabled={readonly}
      />
      <label class="text-xs flex gap-2 items-center"
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
    </div>{/each}
  {#if !items.length}<p class="text-xs text-neutral-500">
      No local skills.
    </p>{/if}
  <Button
    class="persona-add"
    disabled={readonly || items.length >= 32}
    onclick={() => {
      let n = 1;
      while (items.some((i) => i.id === `skill-${n}`)) n++;
      items = [...items, { id: `skill-${n}`, directory: "skills/name" }];
    }}>Add skill reference</Button
  >
</Section>
