<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Disclosure from "../../lib/ui/Disclosure.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { useSessions } from "./session-client.svelte";
  import { personaKey } from "../persona/persona-client.svelte";
  import PersonaDetails from "../persona/PersonaDetails.svelte";
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
  const personaOptions = $derived([
    { value: "", label: "No persona" },
    ...(sessions.personas.selected &&
    !sessions.personas.items.some(
      (p) => personaKey(p.ref) === sessions.personas.selected,
    )
      ? [
          {
            value: sessions.personas.selected,
            label: "Unavailable persona",
            disabled: true,
          },
        ]
      : []),
    ...sessions.personas.items
      .filter((p) => p.valid && p.revision)
      .map((p) => ({ value: personaKey(p.ref), label: p.name })),
  ]);
  const selectedPersona = $derived(
    sessions.personas.items.find(
      (p) => personaKey(p.ref) === sessions.personas.selected,
    ),
  );
  const noReader = $derived(
    !!selectedPersona?.skillCount &&
      !sessions.catalog.configurations.find((c) => c.value === configuration)
        ?.skillReader,
  );
  const managed = $derived(
    sessions.catalog.configurations.find((c) => c.value === configuration)
      ?.modelSelection === "catalog",
  );
  const models = $derived(
    sessions.providers.catalog.providers.flatMap((provider) =>
      provider.models
        .filter((m) => m.available)
        .map((m) => ({
          value: JSON.stringify({ provider: provider.id, id: m.id }),
          label: `${m.name} · ${provider.name}`,
        })),
    ),
  );
  const defaultChoice = $derived(sessions.providers.catalog.defaultModel);
  const selected = $derived(
    model
      ? models.find((m) => m.value === model)
      : defaultChoice
        ? models.find((m) => m.value === JSON.stringify(defaultChoice))
        : undefined,
  );
  const modelOptions = $derived([
    {
      value: "",
      label: defaultChoice
        ? `Default: ${selected && !model ? selected.label : defaultChoice.id}`
        : "Choose a model",
    },
    ...(model && !models.some((m) => m.value === model)
      ? [{ value: model, label: "Unavailable model", disabled: true }]
      : []),
    ...models,
  ]);
  $effect(() => {
    if (!folder) folder = sessions.catalog.workspaces[0]?.value ?? "";
    if (!configuration)
      configuration = sessions.catalog.configurations[0]?.value ?? "";
  });
  const unavailable = $derived(
    sessions.busy
      ? "Please wait…"
      : mode === "ask"
        ? !folder || !configuration
          ? "Choose a working folder and chat setup."
          : sessions.personas.selected && !sessions.personas.selection
            ? "This persona isn’t available. Choose another or refresh the list."
            : managed &&
                (!selected ||
                  sessions.providers.loading ||
                  sessions.providers.error)
              ? "Choose a model in Providers & models."
              : undefined
        : !sessions.selected || sessions.snapshot?.status !== "idle"
          ? "Open a chat that is ready for a message."
          : undefined,
  );
  async function send() {
    if (unavailable) return;
    if (mode === "ask") {
      const revision = draftRevision;
      const context = JSON.stringify([
        folder,
        configuration,
        model,
        sessions.personas.selected,
      ]);
      if (
        (await sessions.ask(
          draft,
          folder,
          configuration,
          managed && selected ? JSON.parse(selected.value) : undefined,
          sessions.personas.selection,
        )) &&
        revision === draftRevision &&
        context ===
          JSON.stringify([
            folder,
            configuration,
            model,
            sessions.personas.selected,
          ])
      )
        draft = "";
    } else await sessions.reply();
  }
</script>

<form
  class="composer w-full bg-zinc-50 border border-zinc-200/80 rounded-full px-3 py-1.5 flex items-center gap-2 transition-all shadow-elevation-sm focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-950/5 focus-within:bg-white"
  class:composer-reply={mode === "reply"}
  aria-label={mode === "ask" ? "New chat" : "Reply to chat"}
  onsubmit={(event) => {
    event.preventDefault();
    void send();
  }}
>
  <div
    class={"composer-input flex items-center flex-1 min-w-0 gap-2" +
      (mode === "ask" ? " pl-1" : "")}
  >
    {#if mode === "ask"}<Icon
        name="search"
        class="w-4 h-4 text-zinc-400 flex-shrink-0"
      />{/if}
    <Input
      label={mode === "ask" ? "Ask anything" : "Reply to chat"}
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
      appearance="composer"
      placeholder={mode === "ask" ? "Ask anything…" : "Message…"}
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
      >
        {#snippet children(value)}
          <Icon name="folder" class="w-3.5 h-3.5 text-zinc-500" />
          <span>{value}</span>
          <Icon name="chevronDown" class="w-3 h-3 text-zinc-400" />
        {/snippet}
      </Selector>
      <Selector
        label="Persona"
        options={personaOptions}
        bind:value={sessions.personas.selected}
      >
        {#snippet children(value)}<Icon
            name="person"
            class="w-3.5 h-3.5 text-zinc-600"
          /><span class="max-w-28 truncate"
            >{value === "No persona" ? "Persona" : value || "Persona"}</span
          ><Icon name="chevronDown" class="w-3 h-3 text-zinc-400" />{/snippet}
        {#snippet footer()}
          <a
            class="text-xs underline"
            href="#/persona"
            onclick={() => sessions.personas.collection()}>Manage personas</a
          >
          {#if noReader}<p role="status" class="text-[11px] max-w-64 mt-2">
              Skills need file access, which this chat setup doesn’t allow.
            </p>{/if}
          <PersonaDetails error={sessions.personas.error} />
          <Button class="mt-2" onclick={() => sessions.personas.refresh()}
            >Refresh personas</Button
          >
          {#if sessions.catalog.configurations.length > 1}<Disclosure
              title="Advanced"
            >
              <Selector
                label="Chat setup"
                display="field"
                options={sessions.catalog.configurations}
                bind:value={configuration}
              />
            </Disclosure>{/if}
        {/snippet}
      </Selector>
      {#if managed}<Selector
          label="Model"
          options={modelOptions}
          searchable
          bind:value={model}
        >
          {#snippet children(value)}
            <Icon name="model" class="w-3.5 h-3.5 text-zinc-500" />
            <span>{value}</span>
            <Icon name="chevronDown" class="w-3 h-3 text-zinc-400" />
          {/snippet}
        </Selector>{:else}<Button
          aria-label="Preset model"
          unavailable="This chat setup chooses the model."
          ><Icon name="model" class="w-3.5 h-3.5 text-zinc-500" />Preset model</Button
        >{/if}
    {/if}
    <Button
      aria-label={mode === "reply" ? "Send message" : "Start chat"}
      type="submit"
      {unavailable}
      class="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-800 transition-colors shadow-sm ml-0.5 active:scale-95 flex-shrink-0"
      ><Icon name="arrowUp" class="w-4 h-4" /></Button
    >
  </div>
</form>
