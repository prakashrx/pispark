<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { useSessions } from "./session-client.svelte";
  const sessions = useSessions();
  let {
    mode = "ask",
    draft = $bindable(""),
  }: {
    mode?: "ask" | "reply";
    draft?: string;
  } = $props();
  let draftRevision = 0;
  let folder = $state("");
  let configuration = $state("");
  let model = $state("");
  const managed = $derived(sessions.catalog.configurations.find(c => c.value === configuration)?.modelSelection === "catalog");
  const models = $derived(sessions.providers.catalog.providers.flatMap(provider => provider.models.filter(m => m.available).map(m => ({ value: JSON.stringify({ provider: provider.id, id: m.id }), label: `${m.name} · ${provider.name}` }))));
  const defaultChoice = $derived(sessions.providers.catalog.defaultModel);
  const selected = $derived(model ? models.find(m => m.value === model) : defaultChoice ? models.find(m => m.value === JSON.stringify(defaultChoice)) : undefined);
  const modelOptions = $derived([{ value: "", label: defaultChoice ? `Default: ${selected && !model ? selected.label : defaultChoice.id}` : "Choose a model" }, ...models]);
  $effect(() => {
    if (!folder) folder = sessions.catalog.workspaces[0]?.value ?? "";
    if (!configuration) configuration = sessions.catalog.configurations[0]?.value ?? "";
  });
  const unavailable = $derived(
    sessions.busy
      ? "Command pending"
      : mode === "ask"
        ? !folder || !configuration
          ? "Configure a workspace and resource configuration on the server first"
          : managed && (!selected || sessions.providers.loading || sessions.providers.error)
            ? "Choose an available model in Providers & models; unavailable choices are not replaced"
            : undefined
        : !sessions.selected || sessions.snapshot?.status !== "idle"
          ? "Select an idle session to reply"
          : undefined,
  );
  async function send() {
    if (unavailable) return;
    if (mode === "ask") {
      const revision = draftRevision;
      const context = JSON.stringify([folder, configuration, model]);
      if (
        (await sessions.ask(draft, folder, configuration, managed && selected ? JSON.parse(selected.value) : undefined)) &&
        revision === draftRevision && context === JSON.stringify([folder, configuration, model])
      )
        draft = "";
    } else await sessions.reply();
  }
  const pill =
    "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-white hover:bg-zinc-50 border border-zinc-200 rounded-lg transition-colors shadow-elevation-sm";
</script>

<form
  class="composer w-full bg-zinc-50 border border-zinc-200/80 rounded-full px-3 py-1.5 flex items-center gap-2 transition-all shadow-elevation-sm focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-950/5 focus-within:bg-white"
  class:composer-reply={mode === "reply"}
  aria-label={mode === "ask" ? "New session draft" : "Session reply draft"}
  onsubmit={(event) => {
    event.preventDefault();
    void send();
  }}
>
  {#if mode === "reply"}
    <Button
      aria-label="Add context"
      unavailable="Context attachments are not implemented"
      class="p-1 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/50 rounded-full transition-colors flex-shrink-0 flex items-center justify-center"
      ><Icon name="plus" class="w-4 h-4" /></Button
    >
  {/if}
  <div
    class={"composer-input flex items-center flex-1 min-w-0 gap-2" +
      (mode === "ask" ? " pl-1" : "")}
  >
    {#if mode === "ask"}<Icon
        name="search"
        class="w-4 h-4 text-zinc-400 flex-shrink-0"
      />{/if}
    <Input
      label={mode === "ask" ? "Ask anything" : "Reply to session"}
      maxlength={65536}
      value={mode === "ask"
        ? draft
        : (sessions.drafts[sessions.selected] ?? "")}
      oninput={(event) => {
        const text = event.currentTarget.value;
        if (mode === "ask") {
          draftRevision++;
          draft = text;
        } else sessions.setDraft(text);
      }}
      class="w-full text-xs bg-transparent border-none p-0 text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-0 focus:border-transparent outline-none font-sans min-w-0"
      placeholder={mode === "ask"
        ? "Ask anything, or start a new session..."
        : "Reply to session..."}
    />
  </div>
  <div
    class={mode === "ask"
      ? "composer-pickers flex items-center gap-1.5 flex-shrink-0"
      : "flex items-center flex-shrink-0"}
  >
    {#if mode === "ask"}
      <Selector
        label="Folder"
        options={sessions.catalog.workspaces}
        bind:value={folder}
        searchable
        class={pill}
      >
        {#snippet children(value)}
          <Icon name="folder" class="w-3.5 h-3.5 text-zinc-500" />
          <span>{value}</span>
          <Icon name="chevronDown" class="w-3 h-3 text-zinc-400" />
        {/snippet}
      </Selector>
      <Selector label="Resource configuration" options={sessions.catalog.configurations} bind:value={configuration} class={pill}>
        {#snippet children(value)}<Icon name="person" class="w-3.5 h-3.5 text-zinc-600" /><span>{value || "Configuration"}</span><Icon name="chevronDown" class="w-3 h-3 text-zinc-400" />{/snippet}
      </Selector>
      <Button
        aria-label="Style"
        unavailable="Persona-defined styles are not implemented"
        class={pill}>Style</Button
      >
      {#if managed}<Selector
        label="Model"
        options={modelOptions}
        searchable
        bind:value={model}
        class={pill}
      >
        {#snippet children(value)}
          <Icon name="model" class="w-3.5 h-3.5 text-zinc-500" />
          <span>{value}</span>
          <Icon name="chevronDown" class="w-3 h-3 text-zinc-400" />
        {/snippet}
      </Selector>{:else}<Button class={pill} aria-label="Model: host configuration" unavailable="This resource configuration pins its model on the host. Choose a catalog-enabled configuration to select another model."><Icon name="model" class="w-3.5 h-3.5 text-zinc-500" />Host model</Button>{/if}
    {/if}
    <Button
      aria-label={mode === "reply" ? "Send reply" : "Run"}
      type="submit"
      {unavailable}
      class="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-800 transition-colors shadow-sm ml-0.5 active:scale-95 flex-shrink-0"
      ><Icon name="arrowUp" class="w-4 h-4" /></Button
    >
  </div>
</form>
