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
  import Segmented from "../../lib/ui/Segmented.svelte";
  import { Markdown } from "../../lib/markdown";
  import type { AgentClient } from "./agent-client.svelte";
  import type {
    ItemType,
    AvailableResource,
    ResolvedItem,
  } from "../../../../server/src/contract/agent-protocol";
  import {
    ITEM_LABELS,
    originLabel,
    resourceSource,
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
  // Text resources can also be edited in the agent that owns the file.
  const editable = $derived(["instructions", "skills", "prompts"].includes(type));
  let open = $state<string>();
  let text = $state("");
  let baseline = $state("");
  let revision = $state<string | null>(null);
  let loading = $state(false);
  /** A Markdown item can be read as it will be shown: "text" or "preview". */
  let mode = $state("text");
  // Front matter is for Pi, not for reading.
  const readable = (source: string) => source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  let adding = $state(false);
  let choices = $state<AvailableResource[]>([]);
  let pickerError = $state("");
  let loadingChoices = $state(false);
  let pickerRequest = 0;
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
    mode = "text";
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
  async function openPicker() {
    const request = ++pickerRequest;
    adding = true;
    loadingChoices = true;
    choices = [];
    pickerError = "";
    newName = "";
    newText = template(type, "");
    try {
      const available = await client.availableResources(type);
      if (request === pickerRequest) choices = available.resources;
    } catch (error) {
      if (request === pickerRequest) pickerError = (error as Error).message;
    } finally {
      if (request === pickerRequest) loadingChoices = false;
    }
  }
  async function choose(resource: AvailableResource) {
    if (await client.selectResource(type, resource.reference, true)) adding = false;
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
    <button
        type="button"
        class="icon"
        aria-label={`Add ${labels.one}`}
        title={`Add ${labels.one}`}
        onclick={() => void openPicker()}><Icon name="plus" class="h-4 w-4" /></button
      >
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
            {#if item.unavailable}<span class="sub">Resource unavailable.</span>{/if}
            {#if type === "mcp"}<span class="sub">MCP connections are not available yet.</span>{/if}
          </span>
          <span class="origin"
            >{originLabel(item.origin, viewing)}{#if item.reference}{" · "}{resourceSource(item.reference)}{/if}{#if switchLabel(item, viewing)}{" · "}{switchLabel(item, viewing)}{/if}{#if !item.on}{" · "}Off{/if}</span
          >
          <Toggle
              label={`Use ${labels.one} ${item.name}`}
              checked={item.on}
              disabled={client.busy}
              onchange={(event: Event) => void client.toggle(type, item.name, (event.currentTarget as HTMLInputElement).checked)}
            />
          {#if item.reference && client.local(item)}
            <button type="button" class="icon" aria-label={`Remove selection ${item.name}`}
              title="Remove selection" disabled={client.busy}
              onclick={() => void client.selectResource(type, item.reference!, false)}>×</button>
          {/if}
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
      {#if item.path?.endsWith(".md")}<Segmented label="Show" options={[{ value: "text", label: "Text" }, { value: "preview", label: "Preview" }]} bind:value={mode} />{/if}
      {#if mode === "preview" && item.path?.endsWith(".md")}<div class="preview"><Markdown text={readable(text)} /></div>
      {:else}<Textarea label={`${item.name} text`} monospace rows={14} readonly={!local} bind:value={text} />{/if}
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
    {#snippet primary()}{#if editable}<Button variant="primary" type="submit" form="add-item" unavailable={client.busy ? "Saving…" : undefined}
        >Add {labels.one}</Button
      >{/if}{/snippet}
    {#if loadingChoices}
      <p role="status" class="sub">Loading resources…</p>
    {:else if pickerError}
      <p role="alert" class="sub">{pickerError}</p>
    {:else if choices.length}
      <ul class="choices" aria-label="Available resources">
        {#each choices as choice (choice.reference)}
          <li>
            <button type="button" class="choice" disabled={client.busy || items.some(item => item.on && item.reference === choice.reference)}
              onclick={() => void choose(choice)}>
              <span>{choice.name} · {resourceSource(choice.reference)}</span>
              {#if choice.description}<span class="sub">{choice.description}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else if !editable}
      <p class="sub">No resources of this type are available.</p>
    {/if}
    {#if editable}
    <form
      id="add-item"
      class="space-y-3"
      aria-label={`Add ${labels.one}`}
      onsubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      {#if choices.length}<p class="sub">Create an agent-owned {labels.one}</p>{/if}
      <Input
        label="Name"
        placeholder={type === "prompts" ? "review" : "my-" + labels.one}
        bind:value={newName}
        oninput={() => {
          if (!newText || newText === template(type, "")) newText = template(type, newName);
        }}
      />
      <Textarea label="Text" monospace rows={10} bind:value={newText} />
    </form>
    {/if}
    {#if client.editorError}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{client.editorError}</p>{/if}
  </Modal>
{/if}

<style>
  .preview {
    max-height: 24rem;
    overflow-y: auto;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .choices {
    max-height: 14rem;
    overflow: auto;
    margin-bottom: 0.75rem;
  }
  .choice {
    width: 100%;
    padding: 0.5rem;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .choice:hover:not(:disabled) { background: var(--accent); }
  .choice:disabled { color: var(--muted-foreground); }
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
