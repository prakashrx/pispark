<script lang="ts">
  /**
   * One kind of an agent's items as a card (set 1): each with where it comes from and its switch;
   * its name opens its text in a dialog (view, edit, customize, remove); + adds one in a dialog.
   */
  import Card from "../../lib/ui/Card.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Modal from "../../lib/ui/Modal.svelte";
  import ConfirmDialog from "../../lib/ui/ConfirmDialog.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import type { AgentClient } from "./agent-client.svelte";
  import type {
    ItemType,
    ResolvedItem,
  } from "../../../../server/src/contract/agent-protocol";
  import {
    ITEM_LABELS,
    originLabel,
    switchLabel,
    template,
  } from "./agent-presentation";
  let {
    client,
    type,
    description,
    viewing,
    help,
  }: {
    client: AgentClient;
    type: ItemType;
    description: string;
    /** ID of the layer being edited ("session" for a session's own layer). */
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
  /** The description under the title, shown by ?. */
  let helping = $state(false);
  /** The item whose removal waits to be confirmed. */
  let removing = $state<ResolvedItem>();
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
        local || item.origin.id === "session"
          ? client.target
          : { agent: item.origin.id },
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
  const openItem = $derived(items.find((item) => key(item) === open));
  async function closeItem() {
    if (text !== baseline && !confirm("Discard unsaved changes?")) return;
    open = undefined;
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

<Card title={labels.title} count={items.length ? `${items.filter((item) => item.on).length} of ${items.length} on` : undefined}>
  {#snippet action()}
    <button
      type="button"
      class="icon"
      aria-label={`About ${labels.title.toLowerCase()}`}
      aria-expanded={helping}
      title={description}
      onclick={() => (helping = !helping)}>?</button
    >
    {#if editable}<button
        type="button"
        class="icon"
        aria-label={`Add ${labels.one}`}
        title={`Add ${labels.one}`}
        onclick={() => {
          adding = true;
          newName = "";
          newText = template(type, "");
        }}><Icon name="plus" class="h-4 w-4" /></button
      >{/if}
  {/snippet}
  {#if helping}<p class="note">{description}{help ? ` ${help}` : ""}</p>{/if}
  {#if items.length}
    <ul>
      {#each items as item (key(item))}
        <li class="item" data-off={!item.on || undefined}>
          <span class="min-w-0 flex-1">
            {#if editable && item.path}<button type="button" class="name" aria-haspopup="dialog" onclick={() => void show(item)}>{item.name}</button>
            {:else}<span class="name">{item.name}</span>{/if}
            {#if item.description}<span class="sub clamp" title={item.description}>{item.description}</span>{/if}
            {#if type === "mcp"}<span class="sub">Saved in the agent; not connected to sessions yet.</span>{/if}
          </span>
          <span class="origin"
            >{originLabel(item.origin, viewing)}{#if switchLabel(item, viewing)}{" · "}{switchLabel(item, viewing)}{/if}{#if !item.on}{" · "}Off{/if}</span
          >
          {#if type !== "mcp"}<Toggle
              label={`Use ${labels.one} ${item.name}`}
              checked={item.on}
              disabled={client.busy}
              onchange={(event: Event) => void client.toggle(type, item.name, (event.currentTarget as HTMLInputElement).checked)}
            />{/if}
        </li>
      {/each}
    </ul>
  {:else}<p class="note">No {labels.title.toLowerCase()} yet.</p>{/if}
</Card>

{#if openItem}
  {@const item = openItem}
  {@const local = client.local(item)}
  <Modal label={item.name} title={item.name} size="wide" onclose={() => void closeItem()}>
    {#if loading}<p role="status" class="text-sm text-muted-foreground">Loading…</p>
    {:else}
      <p class="text-xs text-muted-foreground">{originLabel(item.origin, viewing)}{local ? "" : ". Customize to make your own copy here; the original stays unchanged."}</p>
      <Textarea label={`${item.name} text`} monospace rows={14} readonly={!local} bind:value={text} />
    {/if}
    {#snippet footer()}
      {#if local}
        <Button
          variant="ghost"
          onclick={() => (removing = item)}>Remove</Button
        >
        <span class="flex-1"></span>
        <Button variant="ghost" onclick={() => void closeItem()}>Close</Button>
        <Button variant="primary" unavailable={text === baseline ? "No changes" : client.busy ? "Saving…" : undefined} onclick={() => void save(item)}>Save</Button>
      {:else}
        <Button variant="ghost" onclick={() => void closeItem()}>Close</Button>
        <Button variant="primary" onclick={() => void client.customize(item).then(() => (open = undefined))}>Customize here</Button>
      {/if}
    {/snippet}
  </Modal>
{/if}

{#if removing}
  {@const item = removing}
  <ConfirmDialog
    title={`Remove this ${labels.one}?`}
    text={`“${item.name}” is removed from this agent.`}
    action={`Remove ${labels.one}`}
    busy={client.busy}
    onconfirm={() =>
      void client.deleteFile(item.path!).then(() => {
        removing = undefined;
        open = undefined;
      })}
    oncancel={() => (removing = undefined)}
  />
{/if}

{#if adding}
  <Modal label={`Add ${labels.one}`} title={`Add ${labels.one}`} size="wide" dismiss={false} onclose={() => (adding = false)}>
    {#snippet primary()}<Button variant="primary" type="submit" form="add-item" unavailable={client.busy ? "Saving…" : undefined}
        >Add {labels.one}</Button
      >{/snippet}
    <form
      id="add-item"
      class="space-y-3"
      aria-label={`Add ${labels.one}`}
      onsubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Input
        label="Name"
        placeholder={type === "prompts" ? "review" : "my-" + labels.one}
        bind:value={newName}
        oninput={() => {
          if (!newText || newText === template(type, "")) newText = template(type, newName);
        }}
      />
      <Textarea label="Text" monospace rows={10} bind:value={newText} />
      {#if client.editorError}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{client.editorError}</p>{/if}
    </form>
  </Modal>
{/if}

<style>
  .note {
    padding: 0.5rem 1rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  ul > li + li {
    border-top: 1px solid var(--border);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    padding: 0.375rem 0.75rem 0.375rem 1rem;
    font-size: var(--text-sm);
  }
  .item[data-off] .name {
    color: var(--muted-foreground);
  }
  .name {
    display: block;
    text-align: left;
    overflow-wrap: anywhere;
  }
  button.name:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .sub {
    display: block;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    overflow-wrap: anywhere;
  }
  .origin {
    flex-shrink: 0;
    max-width: 45%;
    text-align: right;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .icon:hover,
  .icon[aria-expanded="true"] {
    background: var(--accent);
    color: var(--foreground);
  }
  /* One line in the list; the whole description is on the item and in its tooltip. */
  .clamp {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
