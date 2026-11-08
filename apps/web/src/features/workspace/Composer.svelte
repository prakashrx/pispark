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
    quiet = false,
  }: {
    mode?: "ask" | "reply";
    draft?: string;
    // A chat is open: the reply is the primary input, so Ask recedes until used.
    quiet?: boolean;
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
          : sessions.connection !== "Live"
            ? "Waiting for the chat to reconnect."
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
  class="composer w-full flex items-center gap-2 transition-all"
  class:composer-reply={mode === "reply"}
  class:composer-quiet={quiet && !draft}
  aria-label={mode === "ask" ? "New chat" : "Reply to chat"}
  onsubmit={(event) => {
    event.preventDefault();
    void send();
  }}
>
  <div
    class={"composer-input flex items-center flex-1 min-w-0 gap-2" +
      (mode === "ask" ? " pl-2" : " pl-2")}
  >
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
      placeholder={mode === "reply" ? "Message…" : quiet ? "Start a new chat…" : "Ask anything…"}
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
          <Icon name="folder" class="w-4 h-4" />
          <span>{value}</span>
          <Icon name="chevronDown" class="w-3.5 h-3.5 opacity-60" />
        {/snippet}
      </Selector>
      <Selector
        label="Persona"
        options={personaOptions}
        bind:value={sessions.personas.selected}
      >
        {#snippet children(value)}<Icon
            name="person"
            class="w-4 h-4"
          /><span class="max-w-28 truncate"
            >{value === "No persona" ? "Persona" : value || "Persona"}</span
          ><Icon name="chevronDown" class="w-3.5 h-3.5 opacity-60" />{/snippet}
        {#snippet footer()}
          <a
            class="text-sm font-medium text-[var(--interactive-text)] hover:underline"
            href="#/persona"
            onclick={() => sessions.personas.collection()}>Manage personas</a
          >
          {#if noReader}<p role="status" class="text-xs text-muted-foreground max-w-64 mt-2">
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
            <Icon name="model" class="w-4 h-4" />
            <span>{value}</span>
            <Icon name="chevronDown" class="w-3.5 h-3.5 opacity-60" />
          {/snippet}
        </Selector>{:else}<Button
          aria-label="Preset model"
          unavailable="This chat setup chooses the model."
          ><Icon name="model" class="w-4 h-4" />Preset model</Button
        >{/if}
    {/if}
    <Button
      aria-label={mode === "reply" ? "Send message" : "Start chat"}
      type="submit"
      {unavailable}
      class="send-btn flex-shrink-0"
      ><Icon name="arrowUp" class="w-[18px] h-[18px]" /></Button
    >
  </div>
</form>

<style>
  :global(.composer) {
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-composer);
    padding: 0.3125rem 0.3125rem 0.3125rem 0.75rem;
    min-height: 2.75rem;
  }
  :global(.composer:focus-within) {
    border-color: color-mix(in srgb, var(--interactive) 55%, var(--border));
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--interactive) 14%, transparent),
      var(--shadow-composer);
  }
  :global(.composer.composer-quiet:not(:focus-within)) {
    background: var(--muted);
    border-color: transparent;
    box-shadow: none;
  }
  :global(.composer.composer-quiet:not(:focus-within) .composer-pickers .ui-button:not(.send-btn)) {
    background: transparent;
  }
  :global(.composer.composer-quiet:not(:focus-within) .ui-button.send-btn) {
    background: transparent;
  }
  :global(.composer.composer-reply) {
    min-height: 3.5rem;
    padding: 0.5rem 0.5rem 0.5rem 1rem;
  }
  :global(.composer .ui-input[data-appearance="composer"]),
  :global(.composer .ui-input[data-appearance="composer"]:focus) {
    font-size: 0.9375rem;
    color: var(--foreground);
    outline: none;
    box-shadow: none;
  }
  :global(.composer.composer-reply .ui-input[data-appearance="composer"]) {
    font-size: 1rem;
  }
  :global(.composer .ui-input::placeholder) {
    color: var(--subtle-foreground);
    opacity: 1;
  }
  /* Context pickers read as quiet pills until hovered. */
  :global(.composer .composer-pickers .ui-button:not(.send-btn)) {
    gap: 0.375rem;
    height: 2rem;
    padding: 0 0.75rem;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    background: var(--chip);
    color: var(--muted-foreground);
    font-size: 0.8125rem;
    font-weight: 500;
    white-space: nowrap;
  }
  :global(.composer .composer-pickers .ui-button:not(.send-btn):hover:not([aria-disabled="true"])) {
    background: color-mix(in srgb, var(--foreground) 10%, var(--chip));
    color: var(--foreground);
  }
  :global(.composer .composer-pickers .ui-button:not(.send-btn)[aria-expanded="true"]) {
    background: var(--interactive-muted);
    color: var(--interactive-text);
  }
  :global(.composer .ui-button.send-btn) {
    width: 2rem;
    height: 2rem;
    padding: 0;
    border-radius: 50%;
    border: none;
    background: var(--interactive);
    color: var(--interactive-foreground);
    opacity: 1;
    transition: background 0.12s, transform 0.12s;
  }
  :global(.composer.composer-reply .ui-button.send-btn) {
    width: 2.375rem;
    height: 2.375rem;
  }
  :global(.composer .ui-button.send-btn:hover:not(:disabled):not([aria-disabled="true"])) {
    background: var(--interactive-hover);
  }
  :global(.composer .ui-button.send-btn:active:not([aria-disabled="true"])) {
    transform: scale(0.94);
  }
  :global(.composer .ui-button.send-btn[aria-disabled="true"]) {
    background: var(--sidebar-accent);
    color: var(--subtle-foreground);
    opacity: 1;
  }
</style>
