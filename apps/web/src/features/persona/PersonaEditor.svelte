<script lang="ts">
  import { untrack } from "svelte";
  import Section from "../../lib/ui/Section.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import ItemList from "./ItemList.svelte";
  import FolderChoice from "../workspace/FolderChoice.svelte";
  import { sameTarget } from "./persona-client.svelte";
  import { personaError, toolGroups } from "./persona-presentation";
  import { useSessions } from "../workspace/session-client.svelte";
  import type {
    PersonaDefinition,
    PersonaTarget,
    ThinkingLevel,
  } from "../../../../server/src/contract/persona-protocol";
  let {
    target,
    embedded = false,
  }: {
    target: PersonaTarget;
    /** Inside a chat panel: no page header, no delete. */
    embedded?: boolean;
  } = $props();
  const sessions = useSessions();
  const client = sessions.personas;
  $effect(() => {
    if (!sameTarget(target, client.target) || client.mode !== "editor")
      void client.open(target);
  });
  const view = $derived(sameTarget(target, client.view?.target) ? client.view : undefined);
  const viewing = $derived("persona" in target ? target.persona : "chat");
  const isDefault = $derived(viewing === "default");
  const isChat = $derived(viewing === "chat");
  const definition = $derived(view?.definition);
  const base = $derived(definition?.base ?? []);
  const nameOf = (id: string) =>
    client.items.find((p) => p.id === id)?.name ?? id;
  const parentOptions = $derived(
    client.items
      .filter((p) => !p.builtIn && p.id !== viewing && !base.includes(p.id))
      .map((p) => ({ value: p.id, label: p.name })),
  );
  let addParent = $state("");
  $effect(() => {
    if (addParent) {
      const id = addParent;
      addParent = "";
      void client.updateDefinition((d) => ({ ...d, base: [...(d.base ?? []), id] }));
    }
  });
  function removeParent(id: string) {
    if (isChat && base.length === 1) return;
    void client.updateDefinition((d) => {
      const next: PersonaDefinition = { ...d, base: (d.base ?? []).filter((p) => p !== id) };
      if (!next.base?.length) delete next.base;
      return next;
    });
  }
  let editingName = $state(false);
  let name = $state("");
  let description = $state("");
  function editName() {
    name = definition?.name ?? "";
    description = definition?.description ?? "";
    editingName = true;
  }
  async function applyName() {
    const trimmed = description.trim();
    if (
      await client.updateDefinition((d) => {
        const next = { ...d, name: name.trim() };
        if (trimmed) next.description = trimmed;
        else delete next.description;
        return next;
      })
    )
      editingName = false;
  }
  const models = $derived([
    { value: "", label: "No preference (use Ask’s choice or the default)" },
    ...sessions.providers.catalog.providers.flatMap((provider) =>
      provider.models
        .filter((m) => m.available)
        .map((m) => ({
          value: `${provider.id}/${m.id}`,
          label: `${m.name} · ${provider.name}`,
        })),
    ),
  ]);
  const thinkingLevels: { value: ThinkingLevel | ""; label: string }[] = [
    { value: "", label: "Inherit" },
    { value: "off", label: "Off" },
    { value: "minimal", label: "Minimal" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];
  let modelValue = $state("");
  let thinkingValue = $state("");
  $effect(() => {
    modelValue = definition?.settings?.model ?? "";
    thinkingValue = definition?.settings?.thinking ?? "";
  });
  $effect(() => {
    const model = modelValue;
    const thinking = thinkingValue;
    untrack(() => {
      if (!definition || client.busy) return;
      if (model !== (definition.settings?.model ?? "")) setSetting("model", model);
      else if (thinking !== (definition.settings?.thinking ?? ""))
        setSetting("thinking", thinking);
    });
  });
  function setSetting(key: "model" | "thinking", value: string) {
    if ((definition?.settings?.[key] ?? "") === value) return;
    void client.updateDefinition((d) => {
      const settings: NonNullable<PersonaDefinition["settings"]> = {
        ...d.settings,
        [key]: value || undefined,
      };
      if (!settings[key]) delete settings[key];
      const next: PersonaDefinition = { ...d, settings };
      if (!Object.keys(settings).length) delete next.settings;
      return next;
    });
  }
  let home = $state("");
  $effect(() => {
    home = definition?.home ?? "";
  });
  function setHome() {
    const key = home.trim();
    void client.updateDefinition((d) => {
      const next: PersonaDefinition = { ...d, home: key };
      if (!key) delete next.home;
      return next;
    });
  }
  function setFolder(folder: string) {
    if (folder === (definition?.folder ?? "")) return;
    void client.updateDefinition((d) => {
      const next: PersonaDefinition = { ...d, folder };
      if (!folder) delete next.folder;
      return next;
    });
  }
</script>

<div class="space-y-6">
  {#if !embedded}
    <header class="space-y-2 border-b border-[var(--border)] pb-6 persona-heading">
      {#if editingName}
        <form
          class="space-y-3 max-w-xl"
          aria-label="Name and description"
          onsubmit={(event) => {
            event.preventDefault();
            void applyName();
          }}
        >
          <Input label="Name" bind:value={name} maxlength={120} required />
          <Textarea label="Description" bind:value={description} rows={2} maxlength={1024} />
          <div class="flex gap-2">
            <Button variant="primary" type="submit" unavailable={name.trim() ? undefined : "Add a name"}>Apply</Button>
            <Button variant="ghost" onclick={() => (editingName = false)}>Cancel</Button>
          </div>
        </form>
      {:else}
        <div class="flex items-start gap-1">
          <h1 class="text-[1.75rem] leading-tight font-semibold tracking-tight break-words">
            {definition?.name ?? viewing}
          </h1>
          {#if definition}<Button
              variant="ghost"
              size="icon"
              aria-label="Edit name and description"
              class="mt-0.5 text-muted-foreground"
              onclick={editName}><Icon name="pencil" class="h-4 w-4" /></Button
            >{/if}
        </div>
        {#if definition?.description}<p class="text-sm text-muted-foreground break-words">{definition.description}</p>{/if}
        {#if isDefault}<p class="text-sm text-muted-foreground">
            Every persona starts from Default. What you add here reaches every chat unless a persona turns it off.
          </p>{/if}
      {/if}
    </header>
  {/if}
  <p role="status" aria-live="polite" class="text-sm text-muted-foreground min-h-5">
    {client.busy ? "Saving…" : client.status}
  </p>
  {#if client.editorError}<p role="alert" class="inline-note" data-tone="danger">{client.editorError}</p>{/if}
  {#if view?.error}<p role="alert" class="inline-note" data-tone="danger">
      {personaError(view.error, view.detail)} Fix “Builds on” below.
    </p>{/if}
  {#if !view && !client.editorError}<p role="status" class="text-sm text-muted-foreground">Loading…</p>{/if}
  {#if view}
    {#if !isDefault}
      <Section
        title="Builds on"
        description={isChat ? "This chat starts from its persona." : "Default always comes first. Later ones win."}
        layout="split"
        class="border-b border-[var(--border)] pb-6"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip"><Icon name="person" class="h-3.5 w-3.5" />Default<span class="text-muted-foreground">· always</span></span>
          {#each base as id}
            <span class="chip">
              {nameOf(id)}
              {#if !(isChat && base.length === 1)}<button
                  type="button"
                  class="chip-remove"
                  aria-label={`Stop building on ${nameOf(id)}`}
                  disabled={client.busy}
                  onclick={() => removeParent(id)}>×</button
                >{/if}
            </span>
          {/each}
          {#if parentOptions.length}<Selector
              label="Add a persona to build on"
              options={parentOptions}
              bind:value={addParent}
              action
            >
              {#snippet children()}<Icon name="plus" class="h-4 w-4" /><span>Add</span>{/snippet}
            </Selector>{/if}
        </div>
      </Section>
    {/if}
    <ItemList
      {client}
      {viewing}
      type="instructions"
      description="Added to the system prompt, in order."
    />
    <ItemList
      {client}
      {viewing}
      type="skills"
      description="Knowledge the agent loads when a task needs it."
    />
    <ItemList
      {client}
      {viewing}
      type="prompts"
      description="Saved prompts you run by typing /name."
    />
    <ItemList
      {client}
      {viewing}
      type="extensions"
      description="Pi extensions loaded into the chat."
      help="Put extension files in the persona’s extensions folder on the server; they appear here."
    />
    {#if view.items.some((item) => item.type === "mcp")}
      <ItemList {client} {viewing} type="mcp" description="MCP servers from persona.json." />
    {/if}
    <Section title="Tools" description="What the agent may do, from PiSpark and from this persona’s extensions." layout="split" class="border-b border-[var(--border)] pb-6">
      {#each toolGroups(view.tools) as group (group.title)}
        <h4 class="tool-group">{group.title}</h4>
        <ul class="tool-grid" aria-label={`${group.title} tools`}>
          {#each group.tools as tool (tool.name)}
            <li class="flex items-center justify-between gap-3">
              <span class="min-w-0">
                <span class="text-sm font-medium" title={tool.description}>{tool.label ?? tool.name}</span>
                {#if tool.label}<span class="block text-xs text-muted-foreground font-mono">{tool.name}</span>{/if}
                {#if tool.setBy && tool.setBy.id !== viewing}<span class="block text-xs text-muted-foreground">from {tool.setBy.name}</span>
                {:else if tool.setBy}<span class="block text-xs text-muted-foreground">set here</span>{/if}
              </span>
              <Toggle
                label={`Allow ${tool.label ?? tool.name}`}
                checked={tool.on}
                disabled={client.busy}
                onchange={(event: Event) =>
                  void client.toggle("tool", tool.name, (event.currentTarget as HTMLInputElement).checked)}
              />
            </li>
          {/each}
        </ul>
      {/each}
      {#if view.toolsIncomplete}<p class="text-xs text-muted-foreground mt-2">
          Some extensions could not be loaded, so their tools are not listed.
        </p>{/if}
    </Section>
    <Section title="Model" description="A preferred model and thinking level for new chats." layout="split" class="border-b border-[var(--border)] pb-6">
      <div class="grid gap-3 sm:grid-cols-2">
        <Selector
          label="Preferred model"
          display="field"
          searchable
          options={models}
          bind:value={modelValue}
        />
        <Selector
          label="Thinking"
          display="field"
          options={thinkingLevels}
          bind:value={thinkingValue}
        />
      </div>
      {#if view.settings.model && !definition?.settings?.model}<p class="text-xs text-muted-foreground mt-2">
          Inherited: {view.settings.model}
        </p>{/if}
    </Section>
    {#if !isDefault && !isChat}
      <Section
        title="Working folder"
        description="Chats with this persona always work in this folder and read its AGENTS.md."
        layout="split"
        class="border-b border-[var(--border)] pb-6"
      >
        <FolderChoice
          display="field"
          none={view.folder && !definition?.folder ? "Inherited folder" : "None: Ask chooses the folder"}
          bind:value={() => definition?.folder ?? "", setFolder}
        />
        {#if view.folder && !definition?.folder}<p class="text-xs text-muted-foreground mt-2 break-all">
            Inherited: {view.folder}
          </p>{/if}
      </Section>
    {/if}
    {#if !isDefault && !isChat}
      <Section
        title="App"
        description="An app is opened from the sidebar and shows one of its extensions’ views first."
        layout="split"
        class="border-b border-[var(--border)] pb-6"
      >
        <form
          class="flex items-center gap-2 max-w-md"
          aria-label="Home view"
          onsubmit={(event) => {
            event.preventDefault();
            setHome();
          }}
        >
          <Input label="Home view" placeholder="The view’s key, for example desk" maxlength={64} bind:value={home} />
          <Button type="submit" unavailable={home.trim() === (definition?.home ?? "") ? "Nothing to save" : undefined}
            >Save</Button
          >
        </form>
        {#if view.home && !definition?.home}<p class="text-xs text-muted-foreground mt-2">Inherited: {view.home}</p>{/if}
      </Section>
    {/if}
    <Section title="Advanced" description="How this persona is stored." layout="split">
      <div class="space-y-3">
        <p class="text-sm text-muted-foreground break-all">
          {isChat ? "Stored with this chat." : `personas/${viewing}/persona.json`} · Layers: {view.layers.map((l) => l.name).join(" → ")}
        </p>
        <Disclosure title="persona.json">
          <pre class="text-xs overflow-auto max-h-80 mt-2">{JSON.stringify(view.definition, null, 2)}</pre>
        </Disclosure>
        {#if !embedded && !isDefault && !isChat}<Button
            variant="destructive"
            size="compact"
            onclick={() => {
              if (confirm(`Delete persona “${definition?.name ?? viewing}”? Chats that used it keep their messages.`))
                void client.remove(viewing);
            }}>Delete persona</Button
          >{/if}
      </div>
    </Section>
  {/if}
</div>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.625rem;
    border-radius: var(--radius-full);
    background: var(--chip);
    font-size: 0.8125rem;
    font-weight: 500;
  }
  .chip-remove {
    margin-left: 0.125rem;
    color: var(--muted-foreground);
    font-size: 1rem;
    line-height: 1;
  }
  .chip-remove:hover {
    color: var(--foreground);
  }
  .tool-group {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--subtle-foreground);
    margin: 0 0 0.5rem;
  }
  .tool-grid + .tool-group {
    margin-top: 1.25rem;
  }
  .tool-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.75rem 1.5rem;
  }
</style>
