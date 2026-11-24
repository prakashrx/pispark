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
  import Input from "../../lib/ui/Input.svelte";
  import ConfirmDialog from "../../lib/ui/ConfirmDialog.svelte";
  import FolderChoice from "../workspace/FolderChoice.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import type { AgentDefinition, ThinkingLevel } from "../../../../server/src/contract/agent-protocol";
  import { agentError } from "./agent-presentation";
  import { AgentPage, KINDS, keyOf, type Kind } from "./agent-page.svelte";
  import AgentBuilderPanel from "./AgentBuilderPanel.svelte";
  import BackButton from "./BackButton.svelte";
  import InstructionsTab from "./InstructionsTab.svelte";
  import SkillsTab from "./SkillsTab.svelte";
  import PromptsTab from "./PromptsTab.svelte";
  import ExtensionsTab from "./ExtensionsTab.svelte";

  let { id }: { id: string } = $props();
  const sessions = useSessions();
  const client = sessions.agents;
  // svelte-ignore state_referenced_locally
  const page = new AgentPage(client, id);
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
    { value: "", label: view?.settings.model && !definition?.settings?.model ? `Model: inherited · ${view.settings.model}` : "Model: no preference" },
    ...sessions.providers.catalog.providers.flatMap((provider) =>
      provider.models.filter((m) => m.available).map((m) => ({ value: `${provider.id}/${m.id}`, label: `${m.name} · ${provider.name}` })),
    ),
  ]);
  const thinkingLevels: { value: ThinkingLevel | ""; label: string }[] = $derived([
    { value: "", label: view?.settings.thinking && !definition?.settings?.thinking ? `Thinking: inherited · ${view.settings.thinking}` : "Thinking: inherited" },
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

  // Settings.
  const base = $derived(definition?.base ?? []);
  const nameOf = (agent: string) => client.items.find((p) => p.id === agent)?.name ?? agent;
  const parentOptions = $derived(client.items.filter((p) => !p.builtIn && p.id !== id && !base.includes(p.id)).map((p) => ({ value: p.id, label: p.name })));
  let addParent = $state("");
  $effect(() => {
    if (!addParent) return;
    const parent = addParent;
    addParent = "";
    void client.updateDefinition((d) => ({ ...d, base: [...(d.base ?? []), parent] }));
  });
  function removeParent(parent: string) {
    void client.updateDefinition((d) => {
      const next: AgentDefinition = { ...d, base: (d.base ?? []).filter((p) => p !== parent) };
      if (!next.base?.length) delete next.base;
      return next;
    });
  }
  let home = $state("");
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
  let askingDelete = $state(false);

  // The agent's AI, beside the tabs where there's room, in their place on a phone. It works on
  // what's open in the current tab, unless that's cleared to work on the whole agent.
  let ai = $state(false);
  let cleared = $state<string | undefined>();
  const opened = $derived(tab === "settings" ? undefined : page.opened(tab as Kind, narrow));
  const focus = $derived(opened && keyOf(opened) !== cleared ? opened : undefined);
  const canAi = $derived(!!view && !readOnly);
  let aiButton: HTMLButtonElement | undefined = $state();
  function openAi() {
    cleared = undefined;
    ai = true;
  }
  async function closeAi() {
    ai = false;
    await tick();
    aiButton?.focus();
  }
</script>

<div class="page" bind:clientWidth={width}>
  <header class="profile">
    <IdentityMark {name} size="lg" />
    <div class="who">
      {#if editingName}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <form class="name-form" aria-label="Name and description" onsubmit={(event) => { event.preventDefault(); void doneName(true); }} onkeydown={(event) => event.key === "Escape" && void doneName(false)}>
          <input bind:this={nameField} class="name-input" aria-label="Name" bind:value={nameText} maxlength="120" />
          <input class="desc-input" aria-label="What it does" bind:value={descText} maxlength="1024" placeholder="What it does, in a sentence" />
          <div class="name-actions">
            <button type="button" class="ui-button" data-variant="ghost" data-size="compact" onclick={() => void doneName(false)}>Cancel</button>
            <button type="submit" class="ui-button" data-variant="primary" data-size="compact" disabled={!nameText.trim() || client.busy}>Save</button>
          </div>
        </form>
      {:else}
        <div class="name-row">
          <h1 class="name">{name}</h1>
          {#if definition && !readOnly}<button bind:this={pencil} type="button" class="ui-button" data-size="icon" aria-label="Edit name and description" title="Edit name and description" onclick={() => void editName()}><Icon name="pencil" class="h-4 w-4" /></button>{/if}
        </div>
        {#if definition?.description}<p class="desc">{definition.description}</p>{/if}
        {#if id === "default"}<p class="desc">Every agent starts from Default. What you add here reaches every session unless an agent turns it off.</p>{/if}
        {#if readOnly}<p class="desc">Comes with PiSpark and updates with it, so it can't be changed here. To make your own, create an agent that builds on it.</p>{/if}
      {/if}
      {#if view}
        <div class="runs" role="group" aria-label="Runs with">
          {#if kind}<span class="kind">{kind}</span>{/if}
          <Selector label="Preferred model" searchable options={models} bind:value={() => definition?.settings?.model ?? "", (value) => setSetting("model", value)} disabled={readOnly} />
          <Selector label="Thinking" options={thinkingLevels} bind:value={() => definition?.settings?.thinking ?? "", (value) => setSetting("thinking", value)} disabled={readOnly} />
          {#if id !== "default" && !readOnly}
            <FolderChoice none={view.folder && !definition?.folder ? `Inherited · ${view.folder}` : "Folder chosen per session"} bind:value={() => definition?.folder ?? "", setFolder} />
          {/if}
        </div>
      {/if}
    </div>
    <div class="start">
      {#if canAi}<button bind:this={aiButton} type="button" class="ui-button ask-ai" aria-pressed={ai} onclick={() => (ai ? void closeAi() : openAi())}><Icon name="pencil" class="h-4 w-4" />Ask AI</button>{/if}
      <a class="ui-button" data-variant="primary" href="#/new" onclick={() => (client.selected = id)}>New session</a>
    </div>
  </header>

  {#if client.editorError}<p role="alert" class="inline-note" data-tone="danger">{client.editorError}</p>{/if}
  {#if view?.error}<p role="alert" class="inline-note" data-tone="danger">{agentError(view.error, view.detail)} Fix “Builds on” in Settings.</p>{/if}
  {#if !view && !client.editorError}<p role="status" class="loading">Loading…</p>{/if}

  {#if view && ai && narrow}
    <div class="phone-builder">
      <BackButton label={`Back to ${focus?.name || (tab === "settings" ? "Settings" : KINDS[tab as Kind].title)}`} onclick={() => void closeAi()} />
      <AgentBuilderPanel {page} {name} {tab} {focus} narrow onclose={() => void closeAi()} onclear={() => (cleared = opened ? keyOf(opened) : undefined)} />
    </div>
  {:else if view}
    <div class="bench" data-builder={ai || undefined}>
    <Tabs label="Agent" {tabs} bind:value={tab} panelClass="panel">
      {#snippet children(current)}
        {@const t = current as Tab}
        <div class="tab-body" data-settings={t === "settings" || undefined}>
          {#if t === "instructions"}<InstructionsTab {page} {narrow} {name} onai={canAi ? openAi : undefined} />
          {:else if t === "skills"}<SkillsTab {page} {narrow} stacked={ai} onai={canAi ? openAi : undefined} />
          {:else if t === "prompts"}<PromptsTab {page} {narrow} stacked={ai} onai={canAi ? openAi : undefined} />
          {:else if t === "extensions"}<ExtensionsTab {page} onai={canAi ? openAi : undefined} />
          {:else}
            <div class="settings">
              <section class="setting">
                <div class="setting-text">
                  <h2 class="setting-title">Builds on</h2>
                  <p class="setting-sub">It starts with everything these agents have, then adds its own. Later ones win.</p>
                </div>
                <div class="chips">
                  <span class="chip" title="Every agent starts from Default.">Default</span>
                  {#each base as parent (parent)}
                    <span class="chip">{nameOf(parent)}{#if !readOnly}<button type="button" class="chip-x" aria-label={`Stop building on ${nameOf(parent)}`} disabled={client.busy} onclick={() => removeParent(parent)}><Icon name="close" class="h-3 w-3" /></button>{/if}</span>
                  {/each}
                  {#if parentOptions.length && !readOnly && id !== "default"}
                    <Selector label="Build on another agent" options={parentOptions} bind:value={addParent} action>
                      {#snippet children()}<Icon name="plus" class="h-4 w-4" /><span>Add</span>{/snippet}
                    </Selector>
                  {/if}
                </div>
              </section>
              {#if id !== "default"}
                <section class="setting">
                  <div class="setting-text">
                    <h2 class="setting-title"><label for="home-view">App home view</label></h2>
                    <p class="setting-sub">Open this view instead of a conversation, making the agent an app.{#if view.home && !definition?.home}{" "}Inherited: {view.home}.{/if}</p>
                  </div>
                  <form class="home" onsubmit={(event) => { event.preventDefault(); setHome(); }}>
                    <Input id="home-view" label="Home view" placeholder="None" density="compact" maxlength={64} bind:value={home} disabled={readOnly} />
                    {#if !readOnly}<button type="submit" class="ui-button" data-variant="secondary" data-size="compact" disabled={home.trim() === (definition?.home ?? "") || client.busy}>Save</button>{/if}
                  </form>
                </section>
              {/if}
              <section class="setting">
                <div class="setting-text">
                  <h2 class="setting-title">Stored in</h2>
                  <p class="setting-sub mono">{readOnly ? `plugins/agents/${id}/agent.json, in PiSpark` : `agents/${id}/agent.json`}</p>
                </div>
              </section>
              {#if id !== "default" && !readOnly}
                <section class="setting">
                  <div class="setting-text">
                    <h2 class="setting-title">Delete this agent</h2>
                    <p class="setting-sub">Sessions that used it keep their messages. Shared resources stay in the library.</p>
                  </div>
                  <button type="button" class="ui-button" data-variant="destructive" data-size="compact" onclick={() => (askingDelete = true)}>Delete agent</button>
                </section>
              {/if}
            </div>
          {/if}
        </div>
      {/snippet}
    </Tabs>
    {#if ai}
      <aside class="dock">
        <AgentBuilderPanel {page} {name} {tab} {focus} onclose={() => void closeAi()} onclear={() => (cleared = opened ? keyOf(opened) : undefined)} />
      </aside>
    {/if}
    </div>
  {/if}
</div>

{#if askingDelete}
  <ConfirmDialog
    title={`Delete ${name}?`}
    text="Sessions that used it keep their messages. Shared resources stay in the library."
    action="Delete agent"
    busy={client.busy}
    onconfirm={() => void client.remove(id).then(() => (askingDelete = false))}
    oncancel={() => (askingDelete = false)}
  />
{/if}

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
  .ask-ai {
    border-color: color-mix(in srgb, var(--accent-fill) 35%, var(--border));
    color: var(--accent-text);
  }
  .ask-ai:hover,
  .ask-ai[aria-pressed="true"] {
    background: color-mix(in srgb, var(--accent-fill) 10%, transparent);
  }
  .bench {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  .bench[data-builder] {
    grid-template-columns: minmax(0, 1fr) 23rem;
  }
  .dock {
    position: sticky;
    top: 0.5rem;
    height: min(46rem, calc(100vh - 6rem));
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
    overflow: hidden;
  }
  .phone-builder {
    display: flex;
    flex-direction: column;
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
  .settings {
    display: flex;
    flex-direction: column;
  }
  .setting {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1.125rem 1.5rem;
  }
  .setting + .setting {
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .setting-text {
    flex: 1;
    min-width: 0;
  }
  .setting-title {
    font-size: var(--text-md);
    font-weight: 500;
  }
  .setting-sub {
    font-size: var(--text-sm);
    color: var(--muted-foreground);
    overflow-wrap: anywhere;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0.375rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 1.875rem;
    padding: 0 0.625rem;
    border-radius: var(--radius-full);
    background: var(--chip);
    font-size: var(--text-sm);
  }
  .chip-x {
    display: grid;
    place-items: center;
    color: var(--muted-foreground);
  }
  .home {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    width: 18rem;
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
    .setting {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1rem 0;
    }
    .chips {
      justify-content: flex-start;
    }
    .home {
      width: 100%;
    }
  }
</style>
