<script lang="ts">
  import { tick, untrack } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import FormField from "../../lib/ui/FormField.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import Modal from "../../lib/ui/Modal.svelte";
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import ReferenceSettings from "./ReferenceSettings.svelte";
  import { personaName, resourceRows } from "./persona-presentation";
  import type {
    PersonaSkill,
    EffectiveResource,
    PersonaRef,
    PersonaSummary,
  } from "../../../../server/src/persona-protocol";
  let {
    items = $bindable([]),
    readonly = false,
    effective = [],
    customizeId,
    oncustomizehandled,
    reference,
    options = [],
    onchange,
    onexclude,
    active = true,
    contextKey = "",
  }: {
    items: PersonaSkill[];
    readonly?: boolean;
    effective?: EffectiveResource[];
    customizeId?: string;
    oncustomizehandled?: () => void;
    reference: PersonaRef;
    options?: PersonaSummary[];
    onchange?: () => void;
    onexclude?: (id: string) => void;
    active?: boolean;
    contextKey?: string;
  } = $props();
  let advanced = $state<PersonaSkill>(),
    editing = $state<PersonaSkill>();
  let dialog = $state(false),
    directory = $state("");
  let replacementId = $state<string>();
  let openingContext = $state("");
  let root: HTMLDivElement;
  const rows = $derived(resourceRows(items, effective, reference));
  $effect(() => {
    const id = customizeId;
    if (id)
      untrack(() => {
        customize(id);
        oncustomizehandled?.();
      });
  });
  function customize(id: string) {
    const local = items.find((item) => item.id === id);
    open(local);
    if (!local) replacementId = id;
  }
  function move(from: number, to: number) {
    if (readonly || to < 0 || to >= items.length) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    items = next;
    onchange?.();
  }
  function open(item?: PersonaSkill) {
    replacementId = undefined;
    editing = item;
    directory = item?.directory ?? "";
    openingContext = contextKey;
    dialog = true;
  }
  async function submit() {
    if (
      !directory.trim() ||
      readonly ||
      !active ||
      openingContext !== contextKey ||
      (editing && !items.includes(editing))
    )
      return;
    let target = editing;
    if (replacementId) {
      target = items.find((item) => item.id === replacementId);
      if (target) target.directory = directory.trim();
      else {
        if (
          items.length >= 32 ||
          !effective.some((r) => r.id === replacementId)
        )
          return;
        target = {
          id: replacementId,
          directory: directory.trim(),
          replace: true,
        };
        items = [...items, target];
      }
    } else if (editing) editing.directory = directory.trim();
    else {
      if (items.length >= 32) return;
      let n = 1;
      while (
        items.some((i) => i.id === `skill-${n}`) ||
        effective.some((i) => i.id === `skill-${n}`)
      )
        n++;
      target = { id: `skill-${n}`, directory: directory.trim() };
      items = [...items, target];
    }
    dialog = false;
    onchange?.();
    await tick();
    root.querySelector<HTMLButtonElement>("button")?.focus();
  }
</script>

<div class="space-y-3" data-skills bind:this={root}>
  {#each rows as row, index}
    {@const item = row.local}
    {@const known = row.resolved}
    {@const localIndex = item ? items.indexOf(item) : -1}
    <article class="border-b border-neutral-100 pb-3 space-y-2">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-sm font-medium break-words">
            {known?.nativeName ??
              (item?.directory ?? known?.directory)
                ?.split(/[\\/]/)
                .filter(Boolean)
                .at(-1) ??
              "Skill"}
          </h3>
          {#if known?.description}<p class="text-xs text-neutral-500">
              {known.description}
            </p>{/if}
          {#if !item && known}<p class="text-xs text-neutral-500">
              From {personaName(known.origin, options)}
            </p>{/if}
        </div>
        <Menu
          label={`Skill ${index + 1} actions`}
          items={item
            ? [
                {
                  id: "up",
                  label: "Move up",
                  disabled: readonly || localIndex === 0,
                  onselect: () => move(localIndex, localIndex - 1),
                },
                {
                  id: "down",
                  label: "Move down",
                  disabled: readonly || localIndex === items.length - 1,
                  onselect: () => move(localIndex, localIndex + 1),
                },
                {
                  id: "edit",
                  label: "Edit skill",
                  disabled: readonly,
                  onselect: () => open(item),
                },
                {
                  id: "advanced",
                  label: "Advanced settings",
                  disabled: readonly,
                  onselect: () => (advanced = item),
                },
                {
                  id: "remove",
                  label: "Remove",
                  disabled: readonly,
                  destructive: true,
                  onselect: () => {
                    items = items.filter((i) => i !== item);
                    onchange?.();
                  },
                },
              ]
            : known
              ? [
                  {
                    id: "customize",
                    label: "Customize",
                    disabled: readonly || items.length >= 32,
                    onselect: () => customize(known.id),
                  },
                  {
                    id: "exclude",
                    label: "Don’t use",
                    disabled: readonly,
                    onselect: () => onexclude?.(known.id),
                  },
                ]
              : []}
          >{#snippet trigger()}<span
              aria-hidden="true"
              class="text-lg leading-none">⋯</span
            >{/snippet}</Menu
        >
      </div>
      {#if known?.disableModelInvocation}<p class="text-xs">
          Available only when explicitly requested.
        </p>{/if}
      <Disclosure title="Details"
        ><p class="text-xs break-all">
          {item?.directory ?? known?.directory}
        </p></Disclosure
      >
    </article>
  {:else}<p class="text-xs text-neutral-500">No skills to show.</p>{/each}
  <Button disabled={readonly || items.length >= 32} onclick={() => open()}
    >Add skill</Button
  >
</div>
{#if dialog && active}
  <Modal
    label={replacementId
      ? "Customize skill"
      : editing
        ? "Edit skill"
        : "Add skill"}
    title={replacementId
      ? "Customize skill"
      : editing
        ? "Edit skill"
        : "Add skill"}
    help={replacementId
      ? "Choose the skill folder to use instead. No files will be copied."
      : undefined}
    size="small"
    onclose={() => (dialog = false)}
    initialFocus="input"
  >
    <form
      id="skill-reference"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormField
        label="Skill folder"
        help="Use a folder containing SKILL.md. Relative to this persona’s folder."
        required
      >
        {#snippet children(id, describedby)}<Input
            {id}
            aria-describedby={describedby}
            required
            bind:value={directory}
          />{/snippet}
      </FormField>
    </form>
    {#snippet footer()}<Button onclick={() => (dialog = false)}>Cancel</Button
      ><Button
        variant="primary"
        type="submit"
        form="skill-reference"
        disabled={!directory.trim() ||
          readonly ||
          openingContext !== contextKey ||
          (!editing && items.length >= 32)}
        >{replacementId
          ? "Use this skill"
          : editing
            ? "Apply changes"
            : "Add skill"}</Button
      >{/snippet}
  </Modal>
{/if}
{#if advanced && active}<ReferenceSettings
    item={advanced}
    type="skill"
    {readonly}
    onclose={() => {
      advanced = undefined;
      onchange?.();
    }}
  />{/if}
