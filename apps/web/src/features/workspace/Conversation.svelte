<script lang="ts">
  import { untrack } from "svelte";
  import Button from "../../lib/ui/Button.svelte";
  import { tick } from "svelte";
  import ResponseTurn from "./ResponseTurn.svelte";
  import { buildTurns } from "./chat-turns";
  import StyledText from "./StyledText.svelte";
  import WorkingFrames from "./WorkingFrames.svelte";
  import ViewSlot from "./ViewSlot.svelte";
  import { registerToolSlot } from "./extension-views";
  import ChatDetails from "./ChatDetails.svelte";
  import InlinePanel from "../../lib/ui/InlinePanel.svelte";
  import PersonaEditor from "../persona/PersonaEditor.svelte";
  import {
    chatName,
    chatStatus,
    chatStarted,
    folderName,
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
  // While running, an extension may relabel, re-animate or hide the working indicator.
  const working = $derived(chat?.status === "running" ? snapshot?.extensions.working : undefined);
  const status = $derived(
    client.connection === "Connecting" || client.connection === "Loading"
      ? "Opening…"
      : working?.hidden
        ? ""
        : chat?.waiting && chat.status === "running"
          ? chatStatus(chat.status, chat.interrupted, true)
          : (working?.message ?? chatStatus(chat?.status, chat?.interrupted)),
  );
  // Tools an extension placed a component for draw their calls with it while this chat is shown.
  const toolSlots = $derived(
    [...new Set((snapshot?.extensions.views ?? []).filter((v) => v.slot.startsWith("tool:")).map((v) => v.slot.slice(5)))]
      .sort()
      .join("\n"),
  );
  $effect(() => {
    const tools = toolSlots ? toolSlots.split("\n") : [];
    // Registering reads the registry; it must not make this effect depend on it.
    const disposers = untrack(() => tools.map(registerToolSlot));
    return () => disposers.reverse().forEach((dispose) => dispose());
  });
  // An extension's window title names the browser tab while this chat is open.
  $effect(() => {
    const title = snapshot?.extensions.title;
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  });
  const queued = $derived(
    (snapshot?.queue.steering ?? 0) + (snapshot?.queue.followUp ?? 0),
  );
  const running = $derived(["running", "cancelling"].includes(snapshot?.status ?? ""));
  // The chat as turns of ordered segments; extension notices land where they happened.
  const turns = $derived(
    snapshot ? buildTurns(client.live.items, {
          running,
          notices: snapshot.extensions.notices,
          thinkingLabel: snapshot.extensions.thinkingLabel,
          progress: client.live.doc?.progress,
        }) : [],
  );

  // One continuous scroll: older items are read in above as you reach the top, the view stays
  // where it was, and new output follows while you are at the bottom. Following stops only when
  // you scroll up, not because something grew below you, and starts again at the bottom.
  let scroller = $state<HTMLElement>();
  let column = $state<HTMLElement>();
  let top = $state<HTMLElement>();
  let following = $state(true);
  let lastTop = 0;
  let loadingEarlier = $state(false);
  let earlierFailed = $state(false);
  const atBottom = () =>
    !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  async function earlier() {
    if (loadingEarlier || !client.live.more || !scroller) return;
    loadingEarlier = true;
    const fromBottom = scroller.scrollHeight - scroller.scrollTop;
    earlierFailed = !(await client.loadEarlier());
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight - fromBottom;
    loadingEarlier = false;
    // Still at the top (the older page did not fill the view): keep reading.
    if (scroller && scroller.scrollTop < 40 && client.live.more && !earlierFailed) void earlier();
  }
  $effect(() => {
    if (!scroller || !top) return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !earlierFailed) void earlier();
      },
      { root: scroller },
    );
    watcher.observe(top);
    return () => watcher.disconnect();
  });
  // A different chat starts at its end.
  $effect(() => {
    client.selected;
    following = true;
    earlierFailed = false;
  });
  function toBottom() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    lastTop = scroller.scrollTop;
  }
  function onscroll() {
    if (!scroller) return;
    if (atBottom()) following = true;
    else if (scroller.scrollTop < lastTop - 2) following = false;
    lastTop = scroller.scrollTop;
  }
  // Anything that makes the conversation taller (a reply, a late image, a diff, a question) keeps
  // the end in view while following.
  $effect(() => {
    if (!column) return;
    const watcher = new ResizeObserver(() => {
      if (following) toBottom();
    });
    watcher.observe(column);
    return () => watcher.disconnect();
  });
  function jumpToLatest() {
    following = true;
    toBottom();
  }
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
  class="conversation flex-1 overflow-y-auto px-6 pt-8 pb-6 flex flex-col items-center"
  bind:this={scroller}
  {onscroll}
>
  <div class="w-full max-w-3xl flex flex-col gap-8" bind:this={column}>
    <header class="pb-5 border-b border-[var(--border)]">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-3 flex-wrap">
            <h1
              class="text-2xl font-semibold tracking-tight text-foreground break-words"
            >
              {chat ? chatName(chat) : "New chat"}
            </h1>
            {#if status}<span role="status" class="chat-status" class:custom-indicator={!!working?.frames}
                >{#if working?.frames}<WorkingFrames frames={working.frames} intervalMs={working.intervalMs} />{/if}{status}</span
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
    {#if snapshot?.extensions.header}<StyledText class="extension-header" lines={snapshot.extensions.header} />{/if}
    <ViewSlot slot="header" />
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
      <div bind:this={top} aria-hidden="true"></div>
      {#if loadingEarlier}<p role="status" class="text-sm text-muted-foreground">Loading earlier messages…</p>
      {:else if client.live.more && earlierFailed}<Button
          class={button}
          onclick={() => {
            earlierFailed = false;
            void earlier();
          }}>Load earlier messages</Button
        >{/if}
      <div class="flex flex-col gap-8">
        {#each turns as turn (turn.key)}
          <ResponseTurn {turn} sessionId={client.selected} />
        {/each}
      </div>
    {/if}
    <div class="h-10"></div>
    {#if !following && turns.length}<div class="jump">
        <Button class={button} onclick={jumpToLatest}>Jump to latest</Button>
      </div>{/if}
  </div>
</main>

<style>
  /* Prepending older items must not move what you are reading; the position is restored by hand. */
  .conversation {
    overflow-anchor: none;
  }
  .jump {
    position: sticky;
    bottom: 0.5rem;
    display: flex;
    justify-content: center;
    pointer-events: none;
    margin-top: -2.5rem;
  }
  .jump :global(.ui-button) {
    pointer-events: auto;
  }
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
  .chat-status.custom-indicator::before {
    display: none;
  }
  :global(.styled-text.extension-header) {
    color: var(--muted-foreground);
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
