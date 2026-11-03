<script lang="ts">
  import { untrack } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import OrderControls from "./OrderControls.svelte";
  import PersonaDetails from "./PersonaDetails.svelte";
  import type {
    PersonaParent,
    PersonaSummary,
    ResourceSelection,
    PersonaDocument,
    EffectiveResource,
  } from "../../../../server/src/persona-protocol";
  import { personaKey, personaRequest } from "./persona-client.svelte";
  import {
    samePersona,
    resourceLabel,
    personaName,
  } from "./persona-presentation";
  let {
    parents = $bindable([]),
    exclude = $bindable({}),
    options,
    selfId,
    loadContext,
    readonly = false,
    onresources,
  }: {
    parents: PersonaParent[];
    exclude: ResourceSelection;
    options: PersonaSummary[];
    selfId: string;
    loadContext?: PersonaDocument;
    readonly?: boolean;
    onresources?: (resources: EffectiveResource[]) => void;
  } = $props();
  let choice = $state("");
  type ParentRead = { document?: PersonaDocument; error?: string };
  let reads = $state<Record<string, ParentRead>>({});
  const referenceKey = (p: PersonaParent) =>
    personaKey({ root: p.root, path: p.path, id: p.id });
  let previousContext: PersonaDocument | undefined;
  // Successful child loads/checks supply a new effective document. Checkbox edits and catalog polling do not.
  $effect(() => {
    const context = loadContext;
    const refs = parents
      .slice(0, 8)
      .map((p) => ({ root: p.root, path: p.path, id: p.id }));
    let active = true;
    untrack(() => {
      const previous = context === previousContext ? reads : {};
      previousContext = context;
      reads = Object.fromEntries(
        refs.flatMap((ref) =>
          previous[personaKey(ref)]?.document ||
          previous[personaKey(ref)]?.error
            ? [[personaKey(ref), previous[personaKey(ref)]!]]
            : [],
        ),
      );
      for (const ref of refs) {
        const key = personaKey(ref);
        if (reads[key]) continue;
        reads[key] = {};
        void personaRequest<PersonaDocument>("read", { ref })
          .then((document) => {
            if (active) reads[key] = { document };
          })
          .catch((error: Error) => {
            if (active) reads[key] = { error: error.message };
          });
      }
    });
    return () => {
      active = false;
    };
  });
  $effect(() => {
    const resources = parents.flatMap((parent) => {
      const doc = reads[referenceKey(parent)]?.document;
      return doc ? [...doc.instructions, ...doc.skills] : [];
    });
    untrack(() => onresources?.(resources));
  });
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
  function toggle(
    parent: PersonaParent,
    type: keyof ResourceSelection,
    id: string,
    checked: boolean,
  ) {
    const resources = reads[referenceKey(parent)]?.document?.[type] ?? [];
    const selected = new Set(
      parent.include?.[type] ?? resources.map((r) => r.id),
    );
    if (checked) selected.add(id);
    else selected.delete(id);
    parent.include ??= {};
    if (
      resources.length &&
      selected.size === resources.length &&
      resources.every((r) => selected.has(r.id))
    )
      delete parent.include[type];
    else parent.include[type] = [...selected];
  }
</script>

<Section
  title="Based on"
  description="Start with another persona’s instructions and skills, then customize them here."
  class="space-y-3 pt-4 border-t border-gray-100"
>
  {#each parents as parent, index (parent)}
    {@const read = reads[referenceKey(parent)]}
    <div class="p-4 border border-gray-200 rounded-xl space-y-3">
      <div class="flex justify-between gap-2 flex-wrap">
        <p class="text-xs">{personaName(parent, options)}</p>
        <OrderControls
          {index}
          count={parents.length}
          label={`based-on persona ${index + 1}`}
          {move}
          remove={() => (parents = parents.filter((_, i) => i !== index))}
          disabled={readonly}
        />
      </div>
      <details class="text-xs space-y-3">
        <summary>Choose what to use</summary>
        {#if !read || (!read.document && !read.error)}<p role="status">
            Loading resources…
          </p>{/if}
        <PersonaDetails
          error={read?.error}
          diagnostics={read?.document?.diagnostics}
        />
        {#if read?.document}{#each ["instructions", "skills"] as type}
            {@const key = type as keyof ResourceSelection}
            {@const resources = read.document[key]}
            <fieldset class="space-y-2 mt-3">
              <legend class="font-semibold capitalize">{type}</legend>
              {#each resources as resource}<label class="flex gap-2 items-start"
                  ><input
                    type="checkbox"
                    aria-label={`${index + 1} · ${type} · ${resourceLabel(resource)}`}
                    checked={parent.include?.[key] === undefined ||
                      parent.include[key]!.includes(resource.id)}
                    disabled={readonly}
                    onchange={(event) =>
                      toggle(
                        parent,
                        key,
                        resource.id,
                        event.currentTarget.checked,
                      )}
                  />{resourceLabel(resource)}</label
                >{:else}<p>No {type} available.</p>{/each}
              {#each parent.include?.[key]?.filter((id) => !resources.some((r) => r.id === id)) ?? [] as id}<label
                  class="flex gap-2 items-start"
                  ><input
                    type="checkbox"
                    checked
                    disabled={readonly}
                    onchange={(event) =>
                      toggle(parent, key, id, event.currentTarget.checked)}
                  />Reference {id} · unavailable</label
                >{/each}
            </fieldset>
          {/each}{/if}
      </details>
      <details class="text-xs space-y-2">
        <summary>Details</summary>
        <p class="break-all">{parent.root}/{parent.path} · {parent.id}</p>
      </details>
      <details class="text-xs space-y-2">
        <summary>Advanced</summary>
        {#each ["instructions", "skills"] as type}{@const key =
            type as keyof ResourceSelection}
          <label class="flex gap-2 items-center mt-2"
            ><input
              type="checkbox"
              checked={parent.include?.[key] === undefined}
              disabled={readonly}
              onchange={(event) => {
                parent.include ??= {};
                if (event.currentTarget.checked) delete parent.include[key];
                else parent.include[key] = [];
              }}
            />All {type}</label
          >
          {#if parent.include?.[key] !== undefined}<label class="block"
              >Included {type} reference names (comma-separated; empty means none)<input
                class="source-input mt-1"
                aria-label={`Parent ${index + 1} included ${type}`}
                value={parent.include[key]?.join(", ")}
                disabled={readonly}
                onchange={(event) => {
                  parent.include![key] = ids(event.currentTarget.value);
                }}
              /></label
            >{/if}
        {/each}
      </details>
    </div>
  {/each}
  <div class="flex gap-2 flex-wrap">
    <select
      aria-label="Choose a persona to build on"
      class="source-input max-w-sm"
      bind:value={choice}
      disabled={readonly}
      ><option value="">Choose a persona</option
      >{#each options.filter((p) => p.valid && p.ref.id !== selfId && !parents.some( (r) => samePersona(r, p.ref), )) as persona}<option
          value={personaKey(persona.ref)}>{persona.name}</option
        >{/each}</select
    ><Button
      class="persona-add"
      disabled={readonly || !choice || parents.length >= 8}
      onclick={() => {
        parents = [...parents, JSON.parse(choice)];
        choice = "";
      }}>Add persona</Button
    >
  </div>
  <details class="text-xs space-y-2">
    <summary>Advanced</summary>{#each ["instructions", "skills"] as type}<label
        class="block mt-2"
        >Not used: {type} reference names (comma-separated)<input
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
  </details>
</Section>
