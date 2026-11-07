<script lang="ts">
  import { untrack } from "svelte";

  import Button from "../../lib/ui/Button.svelte";

  import FieldGroup from "../../lib/ui/FieldGroup.svelte";

  import Checkbox from "../../lib/ui/Checkbox.svelte";

  import Disclosure from "../../lib/ui/Disclosure.svelte";

  import InlinePanel from "../../lib/ui/InlinePanel.svelte";

  import Selector from "../../lib/ui/Selector.svelte";

  import MultiSelect from "../../lib/ui/MultiSelect.svelte";

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

    onchange,

    active = true,
  }: {
    parents: PersonaParent[];

    exclude: ResourceSelection;

    options: PersonaSummary[];

    selfId: string;

    loadContext?: PersonaDocument;

    readonly?: boolean;

    onresources?: (resources: EffectiveResource[]) => void;

    onchange?: () => void;

    active?: boolean;
  } = $props();

  let choice = $state("");

  let adding = $state(false);

  let advanced = $state<PersonaParent | "exclude">();

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

  const validateReference = (value: string) =>
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64
      ? undefined
      : "Use a reference name of up to 64 lowercase letters, numbers and single hyphens.";

  function resourceOptions(
    type: keyof ResourceSelection,
    parent?: PersonaParent,
  ) {
    const resources = parent
      ? (reads[referenceKey(parent)]?.document?.[type] ?? [])
      : parents.flatMap((p) => reads[referenceKey(p)]?.document?.[type] ?? []);

    return [
      ...new Map(
        resources.map((r) => [r.id, { value: r.id, label: resourceLabel(r) }]),
      ).values(),
    ];
  }

  function move(from: number, to: number) {
    const next = [...parents];

    const [item] = next.splice(from, 1);

    next.splice(to, 0, item!);

    parents = next;
    onchange?.();
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
    onchange?.();
  }
</script>

<div class="space-y-4">
  {#each parents as parent, index (parent)}
    {@const read = reads[referenceKey(parent)]}

    <article class="border-b border-[var(--border)] pb-3 space-y-2">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-medium break-words">
          {personaName(parent, options)}
        </h3>
        <OrderControls
          {index}
          count={parents.length}
          label={`reused persona ${index + 1}`}
          {move}
          remove={() => {
            parents = parents.filter((p) => p !== parent);
            onchange?.();
          }}
          disabled={readonly}
          onadvanced={() => (advanced = parent)}
        />
      </div>

      <Disclosure title="Choose what to use">
        {#if !read || (!read.document && !read.error)}<p
            role="status"
            class="text-sm"
          >
            Loading resources…
          </p>{/if}

        <PersonaDetails
          error={read?.error}
          diagnostics={read?.document?.diagnostics}
        />

        {#if read?.document}
          {#each ["instructions", "skills"] as type}
            {@const key = type as keyof ResourceSelection}

            {@const resources = read.document[key]}

            <FieldGroup
              title={type === "instructions" ? "Instructions" : "Skills"}
            >
              {#each resources as resource}<Checkbox
                  label={resourceLabel(resource)}
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
                />{:else}<p class="text-sm">No {type} available.</p>{/each}

              {#each parent.include?.[key]?.filter((id) => !resources.some((r) => r.id === id)) ?? [] as id}<Checkbox
                  label={`Reference ${id} · unavailable`}
                  checked
                  disabled={readonly}
                  onchange={(event) =>
                    toggle(parent, key, id, event.currentTarget.checked)}
                />{/each}
            </FieldGroup>
          {/each}
        {/if}
      </Disclosure>

      <Disclosure title="Details"
        ><p class="text-sm break-all">
          {parent.root}/{parent.path} · {parent.id}
        </p></Disclosure
      >
    </article>
  {/each}

  <div class="flex gap-2">
    <Button
      disabled={readonly || parents.length >= 8}
      onclick={() => {
        choice = "";
        adding = true;
      }}>Use persona</Button
    ><Button variant="ghost" onclick={() => (advanced = "exclude")}
      >Advanced settings</Button
    >
  </div>
</div>

{#if adding && active}
  <InlinePanel
    label="Use persona"
    title="Use persona"
    size="small"
    onclose={() => (adding = false)}
  >
    <Selector
      label="Choose a persona"
      display="field"
      searchable
      options={options
        .filter(
          (p) =>
            p.valid &&
            p.ref.id !== selfId &&
            !parents.some((r) => samePersona(r, p.ref)),
        )
        .map((p) => ({ value: personaKey(p.ref), label: p.name }))}
      bind:value={choice}
    />

    {#snippet footer()}<Button onclick={() => (adding = false)}>Cancel</Button
      ><Button
        variant="primary"
        disabled={!choice}
        onclick={() => {
          const selected = options.find((p) => personaKey(p.ref) === choice);
          if (selected) {
            parents = [...parents, { ...selected.ref }];
            adding = false;
            onchange?.();
          }
        }}>Use persona</Button
      >{/snippet}
  </InlinePanel>
{/if}

{#if advanced && active}
  <InlinePanel
    label="Advanced settings"
    title="Advanced settings"
    onclose={() => {
      advanced = undefined;
      onchange?.();
    }}
  >
    {#each ["instructions", "skills"] as type}
      {@const key = type as keyof ResourceSelection}

      <FieldGroup
        title={advanced === "exclude"
          ? `Not used: ${type}`
          : `Included ${type}`}
      >
        {#if advanced !== "exclude"}
          {@const parent = advanced}

          <Checkbox
            label={`All ${type}`}
            checked={parent.include?.[key] === undefined}
            disabled={readonly}
            onchange={(event) => {
              parent.include ??= {};
              if (event.currentTarget.checked) delete parent.include[key];
              else parent.include[key] = [];
            }}
          />

          {#if parent.include?.[key] !== undefined}<MultiSelect
              label="Reference names"
              options={resourceOptions(key, parent)}
              bind:value={parent.include[key]}
              disabled={readonly}
              allowCustom
              validateCustom={validateReference}
            />{/if}
        {:else}
          <MultiSelect
            label={`Not used ${type} reference names`}
            options={resourceOptions(key)}
            bind:value={
              () => exclude[key] ?? [], (value) => (exclude[key] = value)
            }
            disabled={readonly}
            allowCustom
            validateCustom={validateReference}
          />
        {/if}
      </FieldGroup>
    {/each}

    {#snippet footer()}<Button
        onclick={() => {
          advanced = undefined;
          onchange?.();
        }}>Done</Button
      >{/snippet}
  </InlinePanel>
{/if}
