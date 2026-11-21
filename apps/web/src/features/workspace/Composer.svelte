<script lang="ts">
  import ContributionPoint from "./ContributionPoint.svelte";
  import FolderChoice from "./FolderChoice.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import RichInput from "../../lib/ui/RichInput.svelte";
  import { Attachments } from "./attachments.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import type { Session } from "./session.svelte";
  import { useSession, useSessions } from "./session-client.svelte";
  const sessions = useSessions();
  // The reply box belongs to a session; a new session's box has none yet.
  const session: Session | undefined = useSession();
  let { mode = "ask" }: { mode?: "ask" | "reply" } = $props();
  // A new session's draft has no session yet, so its files wait in the browser; a session's
  // draft uploads at once. Both drafts outlive the screen they were typed on.
  const attachments = $derived(mode === "ask" ? sessions.askAttachments : session?.attachments);
  const text = $derived(mode === "ask" ? sessions.askDraft : (session?.draft ?? ""));
  let input: RichInput | undefined = $state();
  let picker: HTMLInputElement | undefined = $state();
  // A project agent works in its own folder; Ask's choice waits for the next other agent.
  const bound = $derived(sessions.agents.items.find((p) => p.id === sessions.agents.selected)?.folder);
  const agentOptions = $derived([
    ...(sessions.agents.selected &&
    !sessions.agents.items.some((p) => p.id === sessions.agents.selected)
      ? [
          {
            value: sessions.agents.selected,
            label: "Unavailable agent",
            disabled: true,
          },
        ]
      : []),
    ...sessions.agents.items
      .filter((p) => p.valid)
      .map((p) => ({ value: p.id, label: p.name })),
  ]);
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
    sessions.askModel
      ? models.find((m) => m.value === sessions.askModel)
      : defaultChoice
        ? models.find((m) => m.value === JSON.stringify(defaultChoice))
        : undefined,
  );
  const modelOptions = $derived([
    {
      value: "",
      label: defaultChoice
        ? `Default: ${selected && !sessions.askModel ? selected.label : defaultChoice.id}`
        : "Choose a model",
    },
    ...(sessions.askModel && !models.some((m) => m.value === sessions.askModel)
      ? [{ value: sessions.askModel, label: "Unavailable model", disabled: true }]
      : []),
    ...models,
  ]);
  $effect(() => {
    if (!sessions.askFolder) sessions.askFolder = sessions.catalog.recentFolders[0] ?? sessions.catalog.home;
  });
  const unavailable = $derived(
    mode === "reply" && session?.doc?.compacting
      ? "Context is being compacted."
      : sessions.busy
        ? "Please wait…"
      : attachments?.blocked && (mode === "reply" || !attachments.blocked.startsWith("Waiting"))
        ? attachments.blocked
      : mode === "ask"
        ? !bound && !sessions.askFolder
          ? "Choose a working folder."
          : sessions.agents.selected &&
              !sessions.agents.items.some(
                (p) => p.id === sessions.agents.selected && p.valid,
              ) &&
              sessions.agents.items.length
            ? "This agent isn’t available. Choose another."
            : !sessions.askModel &&
                !defaultChoice &&
                !sessions.providers.loading
              ? "Choose a model in Providers & models."
              : undefined
        : !["idle", "error"].includes(session?.doc?.status ?? "")
          ? "Open a session that is ready for a message."
          : session.connection !== "Live"
            ? "Waiting for the session to reconnect."
            : undefined,
  );
  // The turn the session is in, when one is: the button stops or cancels it instead of sending.
  const doc = $derived(mode === "reply" ? session?.doc : undefined);
  const turn = $derived(
    doc && ["running", "cancelling"].includes(doc.status) ? "running" : doc?.status === "queued" ? "queued" : undefined,
  );
  // `/` suggestions (R-09): while a reply is only "/" and a name, the session's prompts and commands
  // that match; arrows move, Enter or Tab picks (the name goes in the box), Escape closes.
  const listId = $props.id();
  let active = $state(0);
  let dismissed = $state("");
  const typed = $derived(mode === "reply" && /^\/[\w:.-]*$/.test(text) ? text.slice(1).toLowerCase() : undefined);
  const suggestions = $derived(
    typed === undefined || dismissed === text
      ? []
      : [...(session?.doc?.prompts ?? []).map((p) => ({ ...p, kind: "prompt" as const })), ...(session?.doc?.commands ?? []).map((c) => ({ ...c, kind: "command" as const }))]
          .filter(({ name }) => name.toLowerCase().includes(typed))
          .sort((a, b) => Number(!a.name.toLowerCase().startsWith(typed)) - Number(!b.name.toLowerCase().startsWith(typed)))
          .slice(0, 8),
  );
  $effect(() => {
    void typed;
    active = 0;
  });
  function pick(name: string) {
    session?.setDraft(`/${name} `);
    input?.focus();
  }
  function suggest(event: KeyboardEvent): boolean {
    if (!suggestions.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      active = (active + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length;
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      // A name typed out in full goes as it is with Enter.
      if (event.key === "Enter" && suggestions.some((s) => s.name.toLowerCase() === typed)) return false;
      pick(suggestions[active]!.name);
      return true;
    }
    if (event.key === "Escape") {
      dismissed = text;
      return true;
    }
    return false;
  }
  async function send() {
    if (unavailable) return;
    if (mode === "ask")
      await sessions.ask(
        sessions.askDraft,
        bound ? undefined : sessions.askFolder,
        sessions.askModel && selected ? JSON.parse(selected.value) : undefined,
        sessions.agents.selected || undefined,
      );
    else await session?.send();
  }
</script>

<div class="composer-wrap">
  <form
    class="composer"
    class:composer-reply={mode === "reply"}
    data-empty={!text.trim() || undefined}
    aria-label={mode === "ask" ? "New session" : "Reply to session"}
    onpointerdown={(event) => {
      // Keep the dock still until the native click submits or stops the turn.
      if (event.pointerType === "touch" && event.target instanceof Element && event.target.closest(".send-btn")) event.preventDefault();
    }}
    onsubmit={(event) => {
      event.preventDefault();
      void send();
    }}
  >
    {#if attachments}<RichInput
        bind:this={input}
        class="composer-text"
        label={mode === "ask" ? "Ask anything" : "Reply to session"}
        value={attachments.pieces(text)}
        tokens={attachments.tokens}
        onchange={(pieces) => {
          const next = Attachments.draft(pieces);
          if (mode === "ask") sessions.editAskDraft(next);
          else session?.setDraft(next);
        }}
        onfiles={(files) => attachments.add(files, mode === "reply" ? session?.id : undefined)}
        onremove={(id) => attachments.remove(id)}
        onsubmit={() => void send()}
        onkey={suggest}
        attributes={suggestions.length
          ? { "aria-controls": listId, "aria-expanded": true, "aria-activedescendant": `${listId}-${active}`, "aria-autocomplete": "list" }
          : { "aria-expanded": mode === "reply" ? false : undefined }}
        placeholder={mode === "reply" ? "Reply…" : "Ask anything…"}
      />{/if}
    {#if suggestions.length}<ul class="slash" id={listId} role="listbox" aria-label="Prompts and commands">
        {#each suggestions as suggestion, index (suggestion.kind + suggestion.name)}<li
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            class:active={index === active}
            onpointerdown={(event) => {
              event.preventDefault();
              pick(suggestion.name);
            }}
          >
            <span class="slash-name">/{suggestion.name}</span>
            {#if suggestion.description}<span class="slash-description">{suggestion.description}</span>{/if}
          </li>{/each}
      </ul>{/if}
    <div class="composer-row">
      <input
        bind:this={picker}
        type="file"
        multiple
        hidden
        onchange={() => {
          input?.insertFiles([...(picker?.files ?? [])]);
          if (picker) picker.value = "";
        }}
      />
      <Button variant="ghost" aria-label="Attach files" title="Attach files" class="attach-btn" onclick={() => picker?.click()}
        ><Icon name="plus" class="w-[18px] h-[18px]" /></Button
      >
      {#if mode === "reply"}<ContributionPoint point="session.input.actions" />{/if}
      <span class="flex-1"></span>
      <!-- One button: Send, Stop while a reply runs, Cancel while the message waits its turn. -->
      {#if turn}<Button
          aria-label={turn === "running" ? "Stop response" : "Cancel queued message"}
          title={turn === "running" ? "Stop" : "Cancel"}
          unavailable={doc?.status === "cancelling" ? "Stopping…" : undefined}
          class="send-btn stop"
          onclick={() => session?.stop()}><Icon name="stop" class="w-[18px] h-[18px]" /></Button
        >{:else}<Button aria-label={mode === "reply" ? "Send message" : "Start session"} type="submit" {unavailable} class="send-btn"
        ><Icon name="arrowUp" class="w-[18px] h-[18px]" /></Button
      >{/if}
    </div>
  </form>
  {#if mode === "ask"}
    <!-- The choices sit where a session's status line later shows them: editable before the start. -->
    <div class="composer-choices" role="group" aria-label="Session choices">
      {#if bound}<FolderChoice value={bound} locked="Set by the agent" />{:else}<FolderChoice bind:value={sessions.askFolder} />{/if}
      <Selector label="Agent" options={agentOptions} bind:value={sessions.agents.selected}>
        {#snippet children(value)}<Icon name="person" class="w-3.5 h-3.5" /><span class="max-w-28 truncate">{value || "Default"}</span
          ><Icon name="chevronDown" class="w-3 h-3 opacity-60" />{/snippet}
        {#snippet footer()}
          <a class="text-sm font-medium text-[var(--interactive-text)] hover:underline" href="#/agents" onclick={() => sessions.agents.collection()}
            >Manage agents</a
          >
          {#if sessions.agents.error}<p role="alert" class="text-xs text-[var(--danger-foreground)] mt-2">{sessions.agents.error}</p>{/if}
        {/snippet}
      </Selector>
      <Selector label="Model" options={modelOptions} searchable bind:value={sessions.askModel}>
        {#snippet children(value)}<Icon name="model" class="w-3.5 h-3.5" /><span class="max-w-44 truncate" title={value}
            >{selected ? selected.label.split(" · ")[0] : value}</span
          ><Icon name="chevronDown" class="w-3 h-3 opacity-60" />{/snippet}
      </Selector>
    </div>
  {/if}
</div>

<style>
  /* `/` suggestions: above the box, inside its frame. */
  .slash {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 0.375rem);
    z-index: 20;
    max-height: 16rem;
    overflow-y: auto;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-raised, var(--background));
    box-shadow: var(--shadow-popover);
  }
  .slash li {
    display: flex;
    flex-direction: column;
    padding: 0.375rem 0.5rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .slash li.active {
    background: var(--accent);
  }
  .slash-name {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .slash-description {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .composer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.625rem 0.5rem 0.5rem 0.875rem;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-composer);
  }
  .composer:focus-within {
    border-color: color-mix(in srgb, var(--interactive) 55%, var(--border));
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--interactive) 14%, transparent),
      var(--shadow-composer);
  }
  /* The text grows with its lines, up to a few, then scrolls. */
  .composer :global(.composer-text) {
    max-height: 40dvh;
    overflow-y: auto;
    padding: 0.125rem 0.375rem 0.125rem 0;
    font-size: var(--text-base);
    line-height: 1.5rem;
    color: var(--foreground);
  }
  .composer :global(.ui-input::placeholder) {
    color: var(--subtle-foreground);
    opacity: 1;
  }
  .composer-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: -0.375rem;
  }
  .composer :global(.attach-btn) {
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border-radius: var(--radius-full);
    color: var(--muted-foreground);
  }
  .composer :global(.send-btn) {
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: var(--interactive);
    color: var(--interactive-foreground);
    transition:
      background 0.12s,
      transform 0.12s;
  }
  .composer :global(.send-btn:hover:not([aria-disabled="true"])) {
    background: var(--interactive-hover);
  }
  .composer :global(.send-btn:active:not([aria-disabled="true"])) {
    transform: scale(0.94);
  }
  /* Not ready yet: one quiet look for both composers; the reason is its tooltip and name. */
  .composer :global(.send-btn[aria-disabled="true"]) {
    background: var(--chip);
    color: var(--subtle-foreground);
    opacity: 1;
  }
  /* Nothing typed yet: Send stays quiet until there is something to send. */
  .composer[data-empty] :global(.send-btn:not([aria-disabled="true"])) {
    background: var(--chip);
    color: var(--muted-foreground);
  }
  /* Stop is always ready while a reply runs, whatever is typed. */
  .composer :global(.send-btn.stop:not([aria-disabled="true"])),
  .composer[data-empty] :global(.send-btn.stop:not([aria-disabled="true"])) {
    background: var(--interactive);
    color: var(--interactive-foreground);
  }
  .composer-choices {
    --selector-weight: 500;
    --selector-hover: var(--muted);
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding: 0.375rem 0.125rem 0;
  }
  /* Quiet until pointed at: the choices are read more often than changed. */
  .composer-choices :global(.ui-button) {
    gap: 0.3rem;
    height: 2rem;
    max-width: 100%;
    padding: 0 0.5rem;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    box-shadow: none;
  }
  .composer-choices :global(.ui-button:hover:not([aria-disabled="true"])),
  .composer-choices :global(.ui-button[aria-expanded="true"]) {
    background: var(--muted);
    color: var(--foreground);
  }
  @media (max-width: 599.98px) {
    .composer-choices :global(.ui-button) {
      height: 2.5rem;
    }
  }
</style>
