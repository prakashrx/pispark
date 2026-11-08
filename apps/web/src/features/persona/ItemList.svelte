<script lang="ts">
  import Section from "../../lib/ui/Section.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import type { PersonaClient } from "./persona-client.svelte";
  import type {
    ItemType,
    ResolvedItem,
  } from "../../../../server/src/persona-protocol";
  import {
    ITEM_LABELS,
    originLabel,
    switchLabel,
    template,
  } from "./persona-presentation";
  let {
    client,
    type,
    description,
    viewing,
    help,
  }: {
    client: PersonaClient;
    type: ItemType;
    description: string;
    /** ID of the layer being edited ("chat" for a chat's own layer). */
    viewing: string;
    help?: string;
  } = $props();
  const labels = $derived(ITEM_LABELS[type]);
  const items = $derived(
    (client.view?.items ?? []).filter((item) => item.type === type),
  );
  // Text items can be read, edited and added here; extensions and MCP servers are listed only.
  const editable = $derived(["instructions", "skills", "prompts"].includes(type));
  let open = $state<string>();
  let text = $state("");
  let baseline = $state("");
  let revision = $state<string | null>(null);
  let loading = $state(false);
  let adding = $state(false);
  let newName = $state("");
  let newText = $state("");
  const key = (item: ResolvedItem) => `${type}:${item.name}`;
  const pathFor = (name: string) =>
    type === "skills" ? `skills/${name}/SKILL.md` : `${type}/${name}.md`;
  $effect(() => {
    client.drafts[`${type}:open`] = open !== undefined && text !== baseline;
    client.drafts[`${type}:new`] = adding && (!!newName || newText !== template(type, newName));
  });
  async function show(item: ResolvedItem) {
    if (open === key(item)) {
      open = undefined;
      return;
    }
    if (open && text !== baseline && !confirm("Discard unsaved changes?")) return;
    open = key(item);
    loading = true;
    try {
      const local = client.local(item);
      const file = await client.readFile(
        item.path!,
        local || item.origin.id === "chat"
          ? client.target
          : { persona: item.origin.id },
      );
      text = baseline = file.text;
      revision = local ? file.revision : null;
    } catch (error) {
      client.editorError = (error as Error).message;
      open = undefined;
    } finally {
      loading = false;
    }
  }
  async function save(item: ResolvedItem) {
    if (await client.writeFile(item.path!, text, revision)) {
      baseline = text;
      const file = await client.readFile(item.path!).catch(() => undefined);
      revision = file?.revision ?? revision;
    }
  }
  async function add() {
    const name = newName.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
      client.editorError = `Use letters, numbers, dots, dashes or underscores for the ${labels.one} name.`;
      return;
    }
    if (await client.writeFile(pathFor(name), newText, null)) {
      adding = false;
      newName = "";
      newText = "";
    }
  }
</script>

<Section title={labels.title} {description} layout="split" class="border-b border-[var(--border)] pb-6">
  <div class="space-y-2">
    {#if help}<p class="text-sm text-muted-foreground">{help}</p>{/if}
    {#if !items.length && !adding}<p class="text-sm text-muted-foreground">
        No {labels.title.toLowerCase()} yet.
      </p>{/if}
    <ul class="space-y-2">
      {#each items as item (key(item))}
        {@const local = client.local(item)}
        <li class="item-row" data-off={!item.on || undefined}>
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <span class="font-medium text-sm break-all">{item.name}</span>
                <span class="text-xs text-muted-foreground">{originLabel(item.origin, viewing)}</span>
                {#if switchLabel(item, viewing)}<span class="text-xs text-muted-foreground">· {switchLabel(item, viewing)}</span>{/if}
                {#if !item.on}<span class="text-xs font-medium text-muted-foreground">· Off</span>{/if}
              </div>
              {#if item.description}<p class="text-sm text-muted-foreground mt-0.5 break-words">{item.description}</p>{/if}
              {#if type === "mcp"}<p class="text-xs text-muted-foreground mt-0.5">Saved in the persona; not connected to chats yet.</p>{/if}
            </div>
            {#if editable && item.path}<Button
                size="compact"
                variant="ghost"
                aria-expanded={open === key(item)}
                onclick={() => void show(item)}
                >{open === key(item) ? "Close" : local ? "Edit" : "View"}</Button
              >{/if}
            {#if type !== "mcp"}<Toggle
                label={`Use ${labels.one} ${item.name}`}
                checked={item.on}
                disabled={client.busy}
                onchange={(event: Event) =>
                  void client.toggle(type, item.name, (event.currentTarget as HTMLInputElement).checked)}
              />{/if}
          </div>
          {#if open === key(item)}
            <div class="mt-3 space-y-2">
              {#if loading}<p role="status" class="text-sm text-muted-foreground">Loading…</p>
              {:else}
                <Textarea
                  label={`${item.name} text`}
                  monospace
                  rows={10}
                  readonly={!local}
                  bind:value={text}
                />
                <div class="flex flex-wrap justify-end gap-2">
                  {#if local}
                    <Button
                      variant="ghost"
                      size="compact"
                      onclick={() => {
                        if (confirm(`Remove ${labels.one} “${item.name}” from this persona?`))
                          void client.deleteFile(item.path!).then(() => (open = undefined));
                      }}>Remove</Button
                    >
                    <Button
                      variant="primary"
                      size="compact"
                      unavailable={text === baseline ? "No changes" : client.busy ? "Saving…" : undefined}
                      onclick={() => void save(item)}>Save</Button
                    >
                  {:else}
                    <p class="text-xs text-muted-foreground mr-auto self-center">
                      Inherited. Customize to make your own copy here; the original stays unchanged.
                    </p>
                    <Button
                      size="compact"
                      onclick={() => void client.customize(item).then(() => (open = undefined))}
                      >Customize here</Button
                    >
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if editable}
      {#if adding}
        <form
          class="item-row space-y-2"
          aria-label={`Add ${labels.one}`}
          onsubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Input label="Name" placeholder={type === "prompts" ? "review" : "my-" + labels.one} bind:value={newName}
            oninput={() => {
              if (!newText || newText === template(type, "")) newText = template(type, newName);
            }} />
          <Textarea label="Text" monospace rows={8} bind:value={newText} />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="compact" onclick={() => (adding = false)}>Cancel</Button>
            <Button variant="primary" size="compact" type="submit" unavailable={client.busy ? "Saving…" : undefined}
              >Add {labels.one}</Button
            >
          </div>
        </form>
      {:else}
        <Button
          size="compact"
          onclick={() => {
            adding = true;
            newName = "";
            newText = template(type, "");
          }}>Add {labels.one}</Button
        >
      {/if}
    {/if}
  </div>
</Section>

<style>
  .item-row {
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
  }
  .item-row[data-off] {
    background: var(--muted);
  }
</style>
