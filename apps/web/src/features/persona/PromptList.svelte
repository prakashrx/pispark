<script lang="ts">
  import { tick, untrack } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import InlinePanel from "../../lib/ui/InlinePanel.svelte";
  import ContentDialog from "../../lib/ui/ContentDialog.svelte";
  import ReferenceSettings from "./ReferenceSettings.svelte";
  import InstructionFile from "./InstructionFile.svelte";
  import {
    resourceRows,
    personaName,
    samePersona,
  } from "./persona-presentation";
  import { personaKey, type PersonaClient } from "./persona-client.svelte";
  import type {
    PersonaInstruction,
    PersonaRef,
    EffectiveResource,
  } from "../../../../server/src/persona-protocol";
  let {
    items = $bindable([]),
    reference,
    declared = [],
    readonly = false,
    client,
    active = true,
    customizeResource,
    oncustomizehandled,
  }: {
    items: PersonaInstruction[];
    reference: PersonaRef;
    declared?: string[];
    readonly?: boolean;
    client: PersonaClient;
    active?: boolean;
    customizeResource?: EffectiveResource;
    oncustomizehandled?: () => void;
  } = $props();
  let advanced = $state<PersonaInstruction>();
  let fileTarget = $state<PersonaInstruction>();
  type Target = {
    key: string;
    value: string;
    local?: PersonaInstruction;
    source?: EffectiveResource;
    mode: "add" | "read" | "edit" | "customize";
    context: number;
  };
  let target = $state<Target>();
  let applyError = $state<string>();
  const rows = $derived(
    resourceRows(items, client.effective?.instructions ?? [], reference),
  );
  // The prompt editor opens inside the row it belongs to; adding opens at the end of the list.
  const contentRow = $derived(
    !target || target.mode === "add"
      ? -1
      : rows.findIndex((row) => {
          // Match by reference name too: a customized prompt becomes a local row with the same ID,
          // and the editor must stay in that row instead of remounting elsewhere.
          const id = target!.local?.id ?? target!.source?.id;
          return (
            (!!target!.local && row.local === target!.local) ||
            (!target!.local && !!target!.source && row.resolved === target!.source) ||
            (id !== undefined && (row.local?.id ?? row.resolved?.id) === id)
          );
        }),
  );
  /** After an editor closes, put focus back where the user was: the row, or Add prompt. */
  async function restoreFocus(row: number) {
    await tick();
    if (document.activeElement && document.activeElement !== document.body) return;
    const list = document.querySelector("[data-instructions]");
    const article = row >= 0 ? list?.querySelectorAll("article")[row] : undefined;
    (
      article?.querySelector<HTMLElement>("[data-read-prompt]") ??
      article?.querySelector<HTMLElement>("button") ??
      Array.from(list?.querySelectorAll<HTMLElement>("button") ?? []).find(
        (button) => button.textContent?.trim() === "Add prompt",
      )
    )?.focus();
  }
  function changed() {
    void client.validate();
  }
  function open(
    local?: PersonaInstruction,
    source?: EffectiveResource,
    mode: Target["mode"] = "read",
  ) {
    const key = `${personaKey(reference)}/${client.contentContext}/${local ? `local:${local.id}:${local.file ?? "inline"}` : source ? `source:${personaKey(source.origin)}:${source.id}` : "add"}`;
    const value =
      local?.file !== undefined
        ? (source?.text ?? client.loadedFileText(reference, local.file))
        : (local?.text ?? source?.text ?? "");
    if (value === undefined && mode !== "add") return;
    const memory = client.promptMemory;
    const sameTarget =
      memory &&
      (memory.key === key ||
        (!!local &&
          local.file === undefined &&
          local.id === memory.customizedId &&
          memory.key.startsWith(
            `${personaKey(reference)}/${client.contentContext}/source:`,
          )));
    const reusable =
      sameTarget && (memory.state?.readText ?? memory.value) === value;
    if (
      memory &&
      !reusable &&
      client.hasUnappliedContent &&
      !window.confirm("Discard unapplied prompt changes?")
    )
      return;
    if (reusable) {
      memory.key = key;
      memory.value = value ?? "";
    } else client.promptMemory = { key, value: value ?? "" };
    applyError = undefined;
    target = {
      key,
      value: value ?? "",
      local,
      source,
      mode,
      context: client.contentContext,
    };
  }
  function customize(source: EffectiveResource) {
    const local = items.find((item) => item.id === source.id);
    if (local)
      open(
        local,
        rows.find((r) => r.local === local)?.resolved,
        local.file === undefined ? "edit" : "read",
      );
    else if (source.text !== undefined) open(undefined, source, "customize");
  }
  $effect(() => {
    const resource = customizeResource;
    if (resource)
      untrack(() => {
        customize(resource);
        oncustomizehandled?.();
      });
  });
  function close() {
    const row = contentRow;
    target = undefined;
    client.promptMemory = undefined;
    void restoreFocus(row);
  }
  function apply(text: string) {
    const current = target;
    if (
      !current ||
      readonly ||
      !active ||
      client.contentContext !== current.context ||
      !client.view ||
      !samePersona(reference, client.view.ref)
    ) {
      applyError =
        "This prompt context changed. Close and reopen it before applying.";
      return false;
    }
    if (current.local) {
      if (!items.includes(current.local) || current.local.file !== undefined)
        return false;
      current.local.text = text;
    } else {
      if (items.length >= 32) {
        applyError =
          "Use at most 32 local prompts. Remove one before adding another.";
        return false;
      }
      if (current.source) {
        if (
          items.some((item) => item.id === current.source!.id) ||
          !client.effective?.instructions.some(
            (r) =>
              r.id === current.source!.id &&
              samePersona(r.origin, current.source!.origin) &&
              r.text === current.value,
          )
        ) {
          applyError =
            "This prompt changed. Close and reopen it before customizing.";
          return false;
        }
        const local = { id: current.source.id, text, replace: true as const };
        items = [...items, local];
        current.local = local;
        if (client.promptMemory?.key === current.key)
          client.promptMemory.customizedId = local.id;
      } else {
        let n = 1;
        while (
          items.some((item) => item.id === `instruction-${n}`) ||
          client.effective?.instructions.some(
            (item) => item.id === `instruction-${n}`,
          )
        )
          n++;
        items = [...items, { id: `instruction-${n}`, text }];
      }
    }
    changed();
    return true;
  }
  async function move(item: PersonaInstruction, direction: number) {
    const from = items.indexOf(item),
      to = from + direction;
    if (readonly || from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    [next[from], next[to]] = [next[to]!, next[from]!];
    items = next;
    await client.validate();
    await tick();
    document
      .querySelector<HTMLButtonElement>(
        `[data-instructions] button[aria-label="Prompt ${to + 1} actions"]`,
      )
      ?.focus();
  }
  function exclude(source: EffectiveResource) {
    if (readonly || !client.draft) return;
    const ids = client.draft.exclude.instructions ?? [];
    if (!ids.includes(source.id))
      client.draft.exclude.instructions = [...ids, source.id];
    changed();
  }
</script>

<div class="space-y-3" data-instructions>
  {#each rows as row, index}
    {@const local = row.local}
    {@const source = row.resolved}
    {@const text =
      local?.file !== undefined
        ? (source?.text ?? client.loadedFileText(reference, local.file))
        : (local?.text ?? source?.text)}
    {@const inherited = !local && source}
    {@const localIndex = local ? items.indexOf(local) : -1}
    {@const editingHere = index === contentRow}
    <article class="prompt-row border-b border-[var(--border)] pb-3 space-y-2">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          {#if editingHere}<p class="text-sm font-medium">
              {target?.mode === "read"
                ? "Reading prompt"
                : target?.mode === "customize"
                  ? "Customizing inherited prompt"
                  : "Editing prompt"}
            </p>
          {:else if text !== undefined}<p
              class:long={text.length > 240 || text.split("\n").length > 3}
              class="prompt-text"
            >
              {text}
            </p>
          {:else}<p class="text-sm text-muted-foreground">
              Prompt text unavailable. Load the existing file to read it.
            </p>{/if}
          {#if inherited}<p class="text-sm text-muted-foreground mt-1">
              From {personaName(inherited.origin, client.items)}
            </p>{/if}
          {#if !client.resourcesCurrent && local}<p
              class="text-sm text-muted-foreground"
            >
              Local draft
            </p>{/if}
        </div>
        <Menu
          label={`Prompt ${index + 1} actions`}
          items={local
            ? [
                {
                  id: "read",
                  label: "Read prompt",
                  disabled: text === undefined,
                  onselect: () => open(local, source),
                },
                {
                  id: "edit",
                  label: local.file !== undefined ? "Edit file" : "Edit",
                  disabled: readonly && local.file === undefined,
                  onselect: () => {
                    if (local.file !== undefined) fileTarget = local;
                    else open(local, source, "edit");
                  },
                },
                {
                  id: "up",
                  label: "Move up",
                  disabled: readonly || localIndex === 0,
                  onselect: () => move(local, -1),
                },
                {
                  id: "down",
                  label: "Move down",
                  disabled: readonly || localIndex === items.length - 1,
                  onselect: () => move(local, 1),
                },
                {
                  id: "advanced",
                  label: "Advanced settings",
                  disabled: readonly,
                  onselect: () => (advanced = local),
                },
                {
                  id: "remove",
                  label: "Remove",
                  disabled: readonly,
                  destructive: true,
                  onselect: () => {
                    items = items.filter((i) => i !== local);
                    changed();
                  },
                },
              ]
            : source
              ? [
                  {
                    id: "read",
                    label: "Read prompt",
                    disabled: text === undefined,
                    onselect: () => open(undefined, source),
                  },
                  {
                    id: "customize",
                    label: "Customize",
                    disabled:
                      readonly || text === undefined || items.length >= 32,
                    onselect: () => customize(source),
                  },
                  {
                    id: "exclude",
                    label: "Don’t use",
                    disabled: readonly,
                    onselect: () => exclude(source),
                  },
                ]
              : []}
          >{#snippet trigger()}<span
              aria-hidden="true"
              class="text-lg leading-none">⋯</span
            >{/snippet}</Menu
        >
      </div>
      {#if editingHere}{@render contentEditor()}{:else if text !== undefined}<Button
          variant="ghost"
          size="compact"
          data-read-prompt
          onclick={() => open(local, source)}
          >{text.length > 240 || text.split("\n").length > 3
            ? "Read full prompt"
            : "Read prompt"}</Button
        >{/if}
      {#if local && fileTarget === local && local.file !== undefined && active}{@render fileEditor(local.file)}{/if}
      {#if local && advanced === local && active}<ReferenceSettings
          item={advanced}
          type="instruction"
          {readonly}
          onclose={() => {
            advanced = undefined;
            changed();
          }}
        />{/if}
    </article>
  {:else}<p class="text-sm text-muted-foreground">No prompts to show.</p>{/each}
  {#if target && contentRow < 0}{@render contentEditor()}{:else}<Button
      disabled={readonly || items.length >= 32}
      onclick={() => open(undefined, undefined, "add")}>Add prompt</Button
    >{/if}
</div>
{#snippet contentEditor()}{#if target}
  <ContentDialog
    variant="editor"
    ownerKey={target.key}
    value={target.value}
    mode={target.mode}
    permission={readonly || target.local?.file !== undefined
      ? "none"
      : target.local
        ? "edit"
        : target.source
          ? "customize"
          : "none"}
    active={active && !client.reading}
    canApply={!readonly && target.context === client.contentContext}
    maxBytes={64 * 1024}
    title="Prompt"
    addTitle="Add prompt"
    editTitle="Edit prompt"
    customizeTitle="Customize prompt"
    label="Instructions"
    addLabel="Add prompt"
    {applyError}
    onapply={apply}
    onclose={close}
    retained={client.promptMemory?.state}
    onstate={(state) => {
      const memory = client.promptMemory;
      if (memory && memory.key === target?.key) memory.state = state;
    }}
  />
{/if}{/snippet}
{#snippet fileEditor(file: string)}
  <InlinePanel
    label="Edit file"
    title="Edit file"
    variant="editor"
    onclose={() => (fileTarget = undefined)}
  >
    {#key `${personaKey(reference)}/${file}`}<InstructionFile
        {reference}
        path={file}
        {client}
        {readonly}
        declared={declared.includes(file)}
      />{/key}
  </InlinePanel>
{/snippet}

<style>
  .prompt-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.875rem;
    line-height: 1.5;
  }
  .prompt-text.long {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
