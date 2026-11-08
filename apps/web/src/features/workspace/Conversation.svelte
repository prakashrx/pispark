<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import NativeTurn from "./NativeTurn.svelte";
  import ChatDetails from "./ChatDetails.svelte";
  import InlinePanel from "../../lib/ui/InlinePanel.svelte";
  import PersonaEditor from "../persona/PersonaEditor.svelte";
  import {
    chatName,
    chatStatus,
    chatStarted,
    folderName,
    visibleTurns,
  } from "./chat-presentation";
  import { useSessions } from "./session-client.svelte";
  const client = useSessions();
  // Editing the persona inside a chat edits this chat's own layer; closing applies it.
  let editingPersona = $state(false);
  async function closePersona() {
    editingPersona = false;
    // The Personas page shares the editor; give it back its list, not this chat's layer.
    client.personas.collection();
    if (client.snapshot?.personaChanged && client.snapshot.status === "idle")
      await client.reload();
  }
  const snapshot = $derived(client.snapshot);
  const chat = $derived(
    snapshot ?? client.sessions.find((s) => s.id === client.selected),
  );
  const status = $derived(
    client.connection === "Connecting" || client.connection === "Loading"
      ? "Opening…"
      : chatStatus(chat?.status, chat?.interrupted),
  );
  const queued = $derived(
    (snapshot?.queue.steering ?? 0) + (snapshot?.queue.followUp ?? 0),
  );
  const turns = $derived(
    snapshot
      ? visibleTurns(
          snapshot.partial
            ? [...snapshot.messages, snapshot.partial]
            : snapshot.messages,
        )
      : [],
  );
  const olderTurns = $derived(
    client.older ? visibleTurns(client.older.messages) : [],
  );
  const modelName = $derived(
    client.providers.catalog.providers
      .find((p) => p.id === snapshot?.model?.provider)
      ?.models.find((m) => m.id === snapshot?.model?.id)?.name,
  );
  const button = "conversation-action";
</script>

<main
  id="workspace"
  aria-label="Chat conversation"
  class="flex-1 overflow-y-auto px-6 pt-8 pb-6 flex flex-col items-center"
>
  <div class="w-full max-w-3xl flex flex-col gap-8">
    <header class="pb-5 border-b border-[var(--border)]">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-3 flex-wrap">
            <h1
              class="text-2xl font-semibold tracking-tight text-foreground break-words"
            >
              {chat ? chatName(chat) : "New chat"}
            </h1>
            {#if status}<span role="status" class="chat-status"
                >{status}</span
              >{/if}
          </div>
          {#if chat}<p class="text-sm text-muted-foreground mt-1.5">
              {[
                chat.persona
                  ? chat.persona.layered
                    ? `${chat.persona.name} (edited here)`
                    : chat.persona.name
                  : undefined,
                folderName(chat.folder),
                modelName,
                chatStarted(chat),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>{:else}<p class="text-sm text-muted-foreground mt-1.5">
              Ask anything in the bar above to start a chat.
            </p>{/if}
        </div>
        {#if snapshot && ["running", "cancelling"].includes(snapshot.status)}<Button
            class={button}
            aria-label="Stop response"
            onclick={() => client.cancel()}>Stop</Button
          >{/if}
        <ChatDetails oneditpersona={() => (editingPersona = true)} />
      </div>
    </header>
    {#if editingPersona && chat}<InlinePanel
        label="Persona for this chat"
        title="Persona for this chat"
        help="Changes apply to this chat only. Closing reloads the chat with them; your messages stay."
        size="wide"
        onclose={() => void closePersona()}
      >
        <PersonaEditor target={{ chat: chat.id }} embedded />
      </InlinePanel>{/if}
    {#if snapshot?.personaChanged && !editingPersona}<p
        role="status"
        class="conversation-notice flex flex-wrap items-center gap-3"
      >
        <span class="flex-1">The persona changed. Reload to apply it; your messages stay.</span>
        <Button
          class={button}
          unavailable={snapshot.status === "idle" ? undefined : "Wait for the reply to finish"}
          onclick={() => client.reload()}>Reload chat</Button
        >
      </p>{/if}
    {#if chat && client.connection === "Disconnected"}<p
        role="alert"
        class="conversation-notice"
      >
        Connection lost. Your chat may still be running. <Button
          class={button}
          onclick={() => client.reconnect()}>Reconnect</Button
        >
      </p>
    {:else if chat && client.connection === "Unloaded"}<p role="status" class="conversation-notice">
        This chat is stopped. <Button class={button} onclick={() => client.reconnect()}>Reopen chat</Button>
      </p>
    {:else if chat && client.connection === "Reconnecting"}<p
        role="status"
        class="conversation-notice"
      >
        Reconnecting…
      </p>{/if}
    {#if snapshot?.interrupted}<p role="status" class="conversation-notice">
        This chat was interrupted. Your saved messages are still here.
      </p>{/if}
    {#if snapshot?.error}<p role="alert" class="conversation-notice">
        Something went wrong. Reopen this chat to try again.
      </p>{/if}
    {#if snapshot}
      {#if queued > 0}<p class="text-sm text-muted-foreground">
          {queued} messages queued
        </p>{/if}
      {#if (client.older?.before ?? snapshot.before) > 0}<Button
          class={button}
          onclick={() => client.history()}>Load earlier messages</Button
        >{/if}
      {#if client.older}<section
          aria-label="Earlier message window"
          class="flex flex-col gap-8"
        >
          <Button class={button} onclick={() => (client.older = undefined)}
            >Back to latest</Button
          >{#each olderTurns as turn}<NativeTurn
              message={turn.message}
              hidden={turn.hidden}
            />{/each}
        </section>{/if}
      {#if snapshot.truncated || client.older?.truncated}<p
          class="text-sm text-muted-foreground"
        >
          Some content isn’t shown in this view.
        </p>{/if}
      <div class="flex flex-col gap-8">
        {#each turns as turn}<NativeTurn
            message={turn.message}
            hidden={turn.hidden}
          />{/each}
      </div>
    {/if}
    <div class="h-10"></div>
  </div>
</main>

<style>
  .chat-status {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.15rem 0.625rem;
    border-radius: var(--radius-full);
    background: var(--interactive-muted);
    color: var(--interactive-text);
    font-size: 0.8125rem;
    font-weight: 500;
  }
  .chat-status::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .conversation-notice {
    padding: 0.75rem 1rem;
    border-radius: var(--radius-md);
    background: var(--muted);
    color: var(--foreground);
    font-size: 0.9375rem;
  }
  :global(.ui-button.conversation-action) {
    align-self: flex-start;
    border-radius: var(--radius-full);
    padding: 0.4rem 0.9rem;
    font-size: 0.875rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }
</style>
