<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import OrderControls from "./OrderControls.svelte";
  import type {
    PersonaParent,
    PersonaSummary,
    ResourceSelection,
  } from "../../../../server/src/persona-protocol";
  import { personaKey } from "./persona-client.svelte";
  let {
    parents = $bindable([]),
    exclude = $bindable({}),
    options,
    selfId,
    readonly = false,
  }: {
    parents: PersonaParent[];
    exclude: ResourceSelection;
    options: PersonaSummary[];
    selfId: string;
    readonly?: boolean;
  } = $props();
  let choice = $state("");
  const ids = (text: string) =>
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  function move(from: number, to: number) {
    const next = [...parents];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    parents = next;
  }
</script>

<Section
  title="Inheritance"
  description="Parents resolve in listed order. Different declarations of the same ID require an explicit replacement or exclusion."
  class="space-y-3 pt-4 border-t border-gray-100"
>
  {#each parents as parent, index (parent)}
    <div class="p-4 border border-gray-200 rounded-xl space-y-3">
      <div class="flex justify-between gap-2 flex-wrap">
        <p class="text-xs break-all">
          {options.find((p) => p.ref.id === parent.id)?.name ?? parent.id} · {parent.root}/{parent.path}
        </p>
        <OrderControls
          {index}
          count={parents.length}
          label={`parent ${index + 1}`}
          {move}
          remove={() => (parents = parents.filter((_, i) => i !== index))}
          disabled={readonly}
        />
      </div>
      {#each ["instructions", "skills"] as type}
        <label class="text-xs flex gap-2 items-center"
          ><input
            type="checkbox"
            checked={parent.include?.[type as keyof ResourceSelection] ===
              undefined}
            disabled={readonly}
            onchange={(event) => {
              const key = type as keyof ResourceSelection;
              parent.include ??= {};
              if (event.currentTarget.checked) delete parent.include[key];
              else parent.include[key] = [];
            }}
          />All parent {type}</label
        >
        {#if parent.include?.[type as keyof ResourceSelection] !== undefined}<label
            class="text-xs block"
            >Included {type} IDs (comma-separated; empty means none)<input
              class="source-input mt-1"
              aria-label={`Parent ${index + 1} included ${type}`}
              value={parent.include[type as keyof ResourceSelection]?.join(
                ", ",
              )}
              disabled={readonly}
              onchange={(event) => {
                parent.include![type as keyof ResourceSelection] = ids(
                  event.currentTarget.value,
                );
              }}
            /></label
          >{/if}
      {/each}
    </div>
  {/each}
  <div class="flex gap-2 flex-wrap">
    <select
      aria-label="Add parent persona"
      class="source-input max-w-sm"
      bind:value={choice}
      disabled={readonly}
      ><option value="">Choose saved parent</option
      >{#each options.filter((p) => p.valid && p.ref.id !== selfId && !parents.some((r) => r.id === p.ref.id)) as persona}<option
          value={personaKey(persona.ref)}
          >{persona.name} · {persona.ref.root}</option
        >{/each}</select
    ><Button
      class="persona-add"
      disabled={readonly || !choice || parents.length >= 8}
      onclick={() => {
        parents = [...parents, JSON.parse(choice)];
        choice = "";
      }}>Add parent</Button
    >
  </div>
  {#each ["instructions", "skills"] as type}<label class="text-xs block"
      >Excluded inherited {type} IDs (comma-separated)<input
        class="source-input mt-1"
        aria-label={`Excluded ${type} IDs`}
        value={exclude[type as keyof ResourceSelection]?.join(", ") ?? ""}
        disabled={readonly}
        onchange={(event) => {
          exclude[type as keyof ResourceSelection] = ids(
            event.currentTarget.value,
          );
        }}
      /></label
    >{/each}
</Section>
