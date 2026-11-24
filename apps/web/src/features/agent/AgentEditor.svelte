<script lang="ts">
  /**
   * An agent's editor (set 1): its name and what it is, what it builds on, then cards: its
   * instructions, skills, prompts and extensions, its tools, its defaults (model, thinking, folder,
   * app home view), and Advanced (where it is stored, its agent.json, Delete).
   */
  import { untrack } from "svelte";
  import Card from "../../lib/ui/Card.svelte";
  import ConfirmDialog from "../../lib/ui/ConfirmDialog.svelte";
  import CardRow from "../../lib/ui/CardRow.svelte";
  import IdentityMark from "../../lib/ui/IdentityMark.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Textarea from "../../lib/ui/Textarea.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import ItemList from "./ItemList.svelte";
  import FolderChoice from "../workspace/FolderChoice.svelte";
  import { sameTarget } from "./agent-client.svelte";
  import { agentError, toolGroups } from "./agent-presentation";
  import { useSessions } from "../workspace/session-client.svelte";
  import type {
    AgentDefinition,
    AgentTarget,
    ThinkingLevel,
  } from "../../../../server/src/contract/agent-protocol";
  let {
    target,
    embedded = false,
  }: {
    target: AgentTarget;
    /** Inside a session panel: no page header, no delete. */
    embedded?: boolean;
  } = $props();
  const sessions = useSessions();
  const client = sessions.agents;
  $effect(() => {
    if (!sameTarget(target, client.target) || client.mode !== "editor")
      void client.open(target);
  });
  const view = $derived(sameTarget(target, client.view?.target) ? client.view : undefined);
  const viewing = $derived("agent" in target ? target.agent : "session");
  const isDefault = $derived(viewing === "default");
  const isSession = $derived(viewing === "session");
  const definition = $derived(view?.definition);
  const base = $derived(definition?.base ?? []);
  // What it is, as the Agents list says it: Base, App or Project.
  const summary = $derived(client.items.find((item) => item.id === viewing));
  const kind = $derived(summary?.builtIn ? "Base" : summary?.home ? "App" : summary?.folder ? "Project" : "");
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
    if (isSession && base.length === 1) return;
    void client.updateDefinition((d) => {
      const next: AgentDefinition = { ...d, base: (d.base ?? []).filter((p) => p !== id) };
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
    { value: "", label: "No preference" },
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
      const settings: NonNullable<AgentDefinition["settings"]> = {
        ...d.settings,
        [key]: value || undefined,
      };
      if (!settings[key]) delete settings[key];
      const next: AgentDefinition = { ...d, settings };
      if (!Object.keys(settings).length) delete next.settings;
      return next;
    });
  }
  let askingDelete = $state(false);
  let home = $state("");
  // What you typed stays until the saved value itself changes (a failed save reloads the agent).
  let savedHome: string | undefined;
  $effect(() => {
    const next = definition?.home ?? "";
    if (next === savedHome) return;
    savedHome = next;
    home = next;
  });
  function setHome() {
    const key = home.trim();
    void client.updateDefinition((d) => {
      const next: AgentDefinition = { ...d, home: key };
      if (!key) delete next.home;
      return next;
    });
  }
  function setFolder(folder: string) {
    if (folder === (definition?.folder ?? "")) return;
    void client.updateDefinition((d) => {
      const next: AgentDefinition = { ...d, folder };
      if (!folder) delete next.folder;
      return next;
    });
  }
</script>

<div class="editor">
  {#if !embedded}
    <header class="head">
      {#if editingName}
        <form
          class="space-y-3 max-w-xl flex-1"
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
        <IdentityMark name={definition?.name ?? viewing} size="lg" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1">
            <h1 class="name">{definition?.name ?? viewing}</h1>
            {#if definition}<Button variant="ghost" size="icon" aria-label="Edit name and description" class="text-muted-foreground" onclick={editName}
                ><Icon name="pencil" class="h-4 w-4" /></Button
              >{/if}
          </div>
          <p class="sub">
            {#if kind}<strong>{kind}</strong>{#if definition?.description}{" · "}{/if}{/if}{definition?.description ?? ""}
          </p>
          {#if isDefault}<p class="sub">Every agent starts from Default. What you add here reaches every session unless an agent turns it off.</p>{/if}
        </div>
      {/if}
    </header>
  {:else}
    <p role="status" aria-live="polite" class="text-sm text-muted-foreground min-h-5">{client.busy ? "Saving…" : client.status}</p>
  {/if}
  {#if client.editorError}<p role="alert" class="inline-note" data-tone="danger">{client.editorError}</p>{/if}
  {#if view?.error}<p role="alert" class="inline-note" data-tone="danger">{agentError(view.error, view.detail)} Fix “Builds on” below.</p>{/if}
  {#if !view && !client.editorError}<p role="status" class="text-sm text-muted-foreground">Loading…</p>{/if}
  {#if view}
    {#if !isDefault}
      <div class="builds" role="group" aria-label="Builds on">
        <span class="label">Builds on</span>
        <span class="chip" title={isSession ? "This session starts from its agent." : "Default always comes first. Later ones win."}
          >Default<span class="text-muted-foreground">· always</span></span
        >
        {#each base as id}
          <span class="chip">
            {nameOf(id)}
            {#if !(isSession && base.length === 1)}<button
                type="button"
                class="chip-remove"
                aria-label={`Stop building on ${nameOf(id)}`}
                disabled={client.busy}
                onclick={() => removeParent(id)}><Icon name="close" class="h-3 w-3" /></button
              >{/if}
          </span>
        {/each}
        {#if parentOptions.length}<Selector label="Add an agent to build on" options={parentOptions} bind:value={addParent} action>
            {#snippet children()}<Icon name="plus" class="h-4 w-4" /><span>Add</span>{/snippet}
          </Selector>{/if}
      </div>
    {/if}
    <div class="cards">
      <ItemList {client} {viewing} type="instructions" description="Added to the system prompt, in order." />
      <ItemList {client} {viewing} type="skills" description="Knowledge the agent loads when a task needs it." />
      <ItemList {client} {viewing} type="prompts" description="Saved prompts you run by typing /name." />
      <ItemList
        {client}
        {viewing}
        type="extensions"
        description="Pi extensions loaded into the session."
        help="Put extension files in the agent’s extensions folder on the server; they appear here."
      />
      {#if view.items.some((item) => item.type === "mcp")}<ItemList {client} {viewing} type="mcp" description="MCP servers from agent.json." />{/if}
      <Card title="Tools" count={`${view.tools.filter((tool) => tool.on).length} of ${view.tools.length} on`}>
        {#each toolGroups(view.tools) as group (group.title)}
          <div class="tools">
            <p class="group">{group.title}</p>
            <ul class="chips" aria-label={`${group.title} tools`}>
              {#each group.tools as tool (tool.name)}
                <li>
                  <button
                    type="button"
                    role="switch"
                    class="tool"
                    aria-checked={tool.on}
                    aria-label={`Allow ${tool.label ?? tool.name}`}
                    title={`${tool.description ?? ""}${tool.label ? ` (${tool.name})` : ""}${tool.setBy ? ` · ${tool.setBy.id === viewing ? "set here" : `from ${tool.setBy.name}`}` : ""}`}
                    disabled={client.busy}
                    onclick={() => void client.toggle("tool", tool.name, !tool.on)}
                    >{#if tool.on}<Icon name="check" class="h-3.5 w-3.5" />{/if}{tool.label ?? tool.name}{#if tool.label}<span class="sr-only">
                        {tool.name}</span
                      >{/if}</button
                  >
                </li>
              {/each}
            </ul>
          </div>
        {/each}
        {#if view.toolsIncomplete}<p class="note">Some extensions could not be loaded, so their tools are not listed.</p>{/if}
      </Card>
      <!-- Values read as values (design set 1/2): plain and to the right, each opening its choices. -->
      <div class="defaults"><Card title="Defaults">
        <CardRow label="Model">
          <Selector label="Preferred model" searchable options={models} bind:value={modelValue} />
        </CardRow>
        <CardRow label="Thinking">
          <Selector label="Thinking" options={thinkingLevels} bind:value={thinkingValue} />
        </CardRow>
        {#if view.settings.model && !definition?.settings?.model}<p class="note">Inherited model: {view.settings.model}</p>{/if}
        {#if !isDefault && !isSession}
          <CardRow label="Working folder">
            <FolderChoice
              none={view.folder && !definition?.folder ? "Inherited folder" : "Chosen per session"}
              bind:value={() => definition?.folder ?? "", setFolder}
            />
          </CardRow>
          {#if view.folder && !definition?.folder}<p class="note break-all">Inherited folder: {view.folder}</p>{/if}
          <CardRow label="App home view">
            <form
              class="home flex items-center justify-end gap-2 flex-1"
              aria-label="Home view"
              onsubmit={(event) => {
                event.preventDefault();
                setHome();
              }}
            >
              <Input label="Home view" placeholder="none" density="compact" maxlength={64} bind:value={home} />
              <Button type="submit" size="compact" unavailable={home.trim() === (definition?.home ?? "") ? "Nothing to save" : undefined}>Save</Button>
            </form>
          </CardRow>
          {#if view.home && !definition?.home}<p class="note">Inherited home view: {view.home}</p>{/if}
        {/if}
      </Card></div>
      <section class="advanced" aria-label="Advanced">
        <Disclosure title="Advanced">
          <div class="space-y-3 mt-2">
            <p class="text-sm text-muted-foreground break-all">
              <span class="mono">{isSession ? "Stored with this session" : `agents/${viewing}/agent.json`}</span> · Layers: {view.layers.map((l) => l.name).join(" → ")}
            </p>
            <pre class="json">{JSON.stringify(view.definition, null, 2)}</pre>
            {#if !embedded && !isDefault && !isSession}<Button
                variant="destructive"
                size="compact"
                onclick={() => (askingDelete = true)}>Delete agent</Button
              >{/if}
          </div>
        </Disclosure>
      </section>
    </div>
  {/if}
</div>

{#if askingDelete}
  <ConfirmDialog
    title="Delete this agent?"
    text={`“${definition?.name ?? viewing}” is deleted. Sessions that used it keep their messages.`}
    action="Delete agent"
    busy={client.busy}
    onconfirm={() => void client.remove(viewing).then(() => (askingDelete = false))}
    oncancel={() => (askingDelete = false)}
  />
{/if}

<style>
  .editor {
    max-width: 62rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }
  .name {
    font-size: var(--text-2xl, 1.5rem);
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .sub {
    font-size: var(--text-sm);
    color: var(--muted-foreground);
    overflow-wrap: anywhere;
  }
  .sub strong {
    color: var(--foreground);
    font-weight: 600;
  }
  .builds {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .label {
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.625rem;
    border-radius: var(--radius-full);
    background: var(--chip);
    font-size: var(--text-sm);
  }
  .chip-remove {
    display: grid;
    place-items: center;
    color: var(--muted-foreground);
  }
  .chip-remove:hover {
    color: var(--foreground);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
    gap: 0.75rem;
    align-items: start;
  }
  .tools {
    padding: 0.5rem 1rem 0.75rem;
  }
  .group {
    margin-bottom: 0.375rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 1.875rem;
    padding: 0 0.625rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .tool[aria-checked="true"] {
    border-style: solid;
    background: var(--chip);
    color: var(--foreground);
  }
  .tool:hover {
    border-color: var(--foreground);
  }
  .note {
    padding: 0.375rem 1rem 0.625rem;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .advanced {
    grid-column: 1 / -1;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .json {
    max-height: 20rem;
    overflow: auto;
    padding: 0.75rem;
    border-radius: var(--radius-md);
    background: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .defaults {
    display: contents;
  }
  .defaults :global(.value) {
    justify-content: flex-end;
  }
  .defaults :global(.ui-selector) {
    max-width: 100%;
  }
  .defaults .home :global(.ui-input) {
    width: 7rem;
  }
</style>
