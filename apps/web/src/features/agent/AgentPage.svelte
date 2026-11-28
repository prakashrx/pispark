<script lang="ts">
  /**
   * An agent's page (task 8): a short profile on top (who it is, what it does, what it runs with),
   * then one tab per kind of resource, each shaped by how Pi uses that kind, and the agent's
   * settings last. Changes to text wait for the save bar; switches and settings save at once.
   */
  import { tick } from "svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import IdentityMark from "../../lib/ui/IdentityMark.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Tabs from "../../lib/ui/Tabs.svelte";
  import FolderChoice from "../workspace/FolderChoice.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import type { AgentDefinition, ThinkingLevel } from "../../../../server/src/contract/agent-protocol";
  import { agentError } from "./agent-presentation";
  import { AgentPage, KINDS, type Kind } from "./agent-page.svelte";
  import InstructionsTab from "./InstructionsTab.svelte";
  import SkillsTab from "./SkillsTab.svelte";
  import PromptsTab from "./PromptsTab.svelte";
  import ExtensionsTab from "./ExtensionsTab.svelte";
  import SettingsTab from "./SettingsTab.svelte";

  let { id }: { id: string } = $props();
  const sessions = useSessions();
  const client = sessions.agents;
  // svelte-ignore state_referenced_locally
  const page = new AgentPage(client, { agent: id });
  // Unsaved text on the page: closing the browser tab asks first.
  $effect(() => {
    client.drafts = { page: page.changed };
    return () => (client.drafts = {});
  });
  $effect(() => {
    void client.open({ agent: id });
  });
  const view = $derived(client.view && "agent" in client.view.target && client.view.target.agent === id ? client.view : undefined);
  const definition = $derived(view?.definition);
  const summary = $derived(client.items.find((item) => item.id === id));
  const name = $derived(definition?.name ?? summary?.name ?? id);
  const kind = $derived(id === "default" ? "Base" : summary?.bundled ? "Bundled" : view?.home ? "App" : view?.folder ? "Project" : "");
  const readOnly = $derived(page.readOnly);

  let width = $state(0);
  const narrow = $derived(width > 0 && width < 760);

  // Name and description, edited in place.
  let editingName = $state(false);
  let nameText = $state("");
  let descText = $state("");
  let pencil: HTMLButtonElement | undefined = $state();
  let nameField: HTMLInputElement | undefined = $state();
  async function editName() {
    nameText = definition?.name ?? "";
    descText = definition?.description ?? "";
    editingName = true;
    await tick();
    nameField?.select();
  }
  async function doneName(save: boolean) {
    if (save && nameText.trim()) {
      const description = descText.trim();
      const ok = await client.updateDefinition((d) => {
        const next = { ...d, name: nameText.trim() };
        if (description) next.description = description;
        else delete next.description;
        return next;
      });
      if (!ok) return;
    }
    editingName = false;
    await tick();
    pencil?.focus();
  }

  // What it runs with: saved as soon as it's chosen.
  const models = $derived([
    {
      value: "",
      label: view?.settings.model && !definition?.settings?.model ? `Model: inherited · ${view.settings.model}` : "Model: no preference",
    },
    // An agent names its model as `provider/id`.
    ...sessions.providers.available.map((model) => ({ value: `${model.provider}/${model.id}`, label: model.label })),
  ]);
  const thinkingLevels: { value: ThinkingLevel | ""; label: string }[] = $derived([
    {
      value: "",
      label:
        view?.settings.thinking && !definition?.settings?.thinking
          ? `Thinking: inherited · ${view.settings.thinking}`
          : "Thinking: inherited",
    },
    { value: "off", label: "Thinking off" },
    { value: "minimal", label: "Minimal thinking" },
    { value: "low", label: "Low thinking" },
    { value: "medium", label: "Medium thinking" },
    { value: "high", label: "High thinking" },
  ]);
  function setSetting(key: "model" | "thinking", value: string) {
    if ((definition?.settings?.[key] ?? "") === value) return;
    void client.updateDefinition((d) => {
      const settings: NonNullable<AgentDefinition["settings"]> = { ...d.settings, [key]: value || undefined };
      if (!settings[key]) delete settings[key];
      const next: AgentDefinition = { ...d, settings };
      if (!Object.keys(settings).length) delete next.settings;
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

  type Tab = Kind | "settings";
  let tab = $state<string>("instructions");
  const count = (k: Kind) => (view?.items ?? []).filter((item) => item.type === k && item.on).length;
  const tabs = $derived([
    ...(["instructions", "skills", "prompts", "extensions"] as Kind[]).map((k) => ({ id: k, label: KINDS[k].title, count: count(k) })),
    { id: "settings", label: "Settings" },
  ]);
</script>

<div class="page" bind:clientWidth={width}>
  <header class="profile">
    <IdentityMark {name} size="lg" />
    <div class="who">
      {#if editingName}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <form
          class="name-form"
          aria-label="Name and description"
          onsubmit={(event) => {
            event.preventDefault();
            void doneName(true);
          }}
          onkeydown={(event) => event.key === "Escape" && void doneName(false)}
        >
          <input bind:this={nameField} class="name-input" aria-label="Name" bind:value={nameText} maxlength="120" />
          <input
            class="desc-input"
            aria-label="What it does"
            bind:value={descText}
            maxlength="1024"
            placeholder="What it does, in a sentence"
          />
          <div class="name-actions">
            <button type="button" class="ui-button" data-variant="ghost" data-size="compact" onclick={() => void doneName(false)}>
              Cancel
            </button>
            <button type="submit" class="ui-button" data-variant="primary" data-size="compact" disabled={!nameText.trim() || client.busy}>
              Save
            </button>
          </div>
        </form>
      {:else}
        <div class="name-row">
          <h1 class="name">{name}</h1>
          {#if definition && !readOnly}<button
              bind:this={pencil}
              type="button"
              class="ui-button"
              data-size="icon"
              aria-label="Edit name and description"
              title="Edit name and description"
              onclick={() => void editName()}
            >
              <Icon name="pencil" class="h-4 w-4" />
            </button>{/if}
        </div>
        {#if definition?.description}<p class="desc">{definition.description}</p>{/if}
        {#if id === "default"}<p class="desc">
            Every agent starts from Default. What you add here reaches every session unless an agent turns it off.
          </p>{/if}
        {#if readOnly}<p class="desc">
            Comes with PiSpark and updates with it, so it can't be changed here. To make your own, create an agent that builds on it.
          </p>{/if}
      {/if}
      {#if view}
        <div class="runs" role="group" aria-label="Runs with">
          {#if kind}<span class="kind">{kind}</span>{/if}
          <Selector
            label="Preferred model"
            searchable
            options={models}
            bind:value={() => definition?.settings?.model ?? "", (value) => setSetting("model", value)}
            disabled={readOnly}
          />
          <Selector
            label="Thinking"
            options={thinkingLevels}
            bind:value={() => definition?.settings?.thinking ?? "", (value) => setSetting("thinking", value)}
            disabled={readOnly}
          />
          {#if id !== "default" && !readOnly}
            <FolderChoice
              none={view.folder && !definition?.folder ? `Inherited · ${view.folder}` : "Folder chosen per session"}
              bind:value={() => definition?.folder ?? "", setFolder}
            />
          {/if}
        </div>
      {/if}
    </div>
    <div class="start">
      <a class="ui-button" data-variant="primary" href="#/new" onclick={() => (client.selected = id)}>New session</a>
    </div>
  </header>

  {#if client.editorError}<p role="alert" class="inline-note" data-tone="danger">{client.editorError}</p>{/if}
  {#if view?.error}<p role="alert" class="inline-note" data-tone="danger">
      {agentError(view.error, view.detail)} Fix “Builds on” in Settings.
    </p>{/if}
  {#if !view && !client.editorError}<p role="status" class="loading">Loading…</p>{/if}

  {#if view}
    <Tabs label="Agent" {tabs} bind:value={tab} panelClass="panel">
      {#snippet children(current)}
        {@const t = current as Tab}
        <!-- Only the tab on show is drawn: each loads what it shows. -->
        {#if t === tab}<div class="tab-body" data-settings={t === "settings" || undefined}>
            {#if t === "instructions"}<InstructionsTab {page} {narrow} {name} />
            {:else if t === "skills"}<SkillsTab {page} {narrow} />
            {:else if t === "prompts"}<PromptsTab {page} {narrow} />
            {:else if t === "extensions"}<ExtensionsTab {page} />
            {:else}
              <SettingsTab {page} {id} />
            {/if}
          </div>{/if}
      {/snippet}
    </Tabs>
  {/if}
</div>

<style>
  .page {
    container: agent / inline-size;
    max-width: 72rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding-bottom: 2rem;
  }
  .profile {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.25rem 0 0;
  }
  .who {
    flex: 1;
    min-width: 0;
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .name {
    font-size: var(--text-2xl);
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .desc {
    margin-top: 0.125rem;
    font-size: var(--text-md);
    color: var(--muted-foreground);
    max-width: 46rem;
  }
  .name-form {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 40rem;
  }
  .name-input,
  .desc-input {
    border: 0;
    border-bottom: 1px solid var(--border);
    padding: 0.125rem 0;
    background: transparent;
  }
  .name-input {
    font-size: var(--text-2xl);
    font-weight: 650;
    letter-spacing: -0.02em;
  }
  .desc-input {
    font-size: var(--text-md);
    color: var(--muted-foreground);
  }
  .name-input:focus-visible,
  .desc-input:focus-visible {
    outline: none;
    border-bottom: 2px solid var(--ring);
  }
  .name-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.375rem;
  }
  .runs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.75rem;
  }
  .kind {
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--muted);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--muted-foreground);
    margin-right: 0.25rem;
  }
  .start {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .loading {
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  /* The tab's body sits on one raised card. */
  .page :global(.panel) {
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--card);
    box-shadow: var(--shadow-card);
  }
  .tab-body {
    min-width: 0;
    min-height: 30rem;
    padding: 1.25rem 1.5rem 1.5rem;
  }
  .tab-body[data-settings] {
    min-height: 0;
    padding: 0;
  }
  @container agent (max-width: 47.5rem) {
    .profile {
      flex-wrap: wrap;
    }
    .start {
      order: 3;
      width: 100%;
    }
    .start > :global(*) {
      flex: 1;
      justify-content: center;
    }
    .page :global(.panel) {
      background: transparent;
      border: 0;
      box-shadow: none;
    }
    .tab-body {
      min-height: 0;
      padding: 0.25rem 0 0.5rem;
    }
  }
</style>
