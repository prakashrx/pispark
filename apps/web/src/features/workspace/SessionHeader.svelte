<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import InlinePanel from "../../lib/ui/InlinePanel.svelte";
  import Menu from "../../lib/ui/Menu.svelte";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import PersonaEditor from "../persona/PersonaEditor.svelte";
  import SchedulesPanel from "../schedules/SchedulesPanel.svelte";
  import SessionDetails from "./SessionDetails.svelte";
  import StyledText from "./StyledText.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import WorkingFrames from "./WorkingFrames.svelte";
  import { folderName, goesByApp, sessionName, sessionStarted, sessionStatus } from "./session-presentation";
  import type { Session } from "./session.svelte";
  import { useSession, useSessions } from "./session-client.svelte";

  /**
   * What PiSpark always says about a session, whichever view shows it: its name and state, the
   * switch between views, the commands its extensions registered, Stop, and the notices a person
   * must not miss. With no chat open it is the empty workspace's heading.
   */
  const client = useSessions();
  const session: Session | undefined = useSession();
  const doc = $derived(session?.doc);
  const info = $derived(session?.info);
  // Editing the persona inside a chat edits this chat's own layer; closing applies it.
  let editingPersona = $state(false);
  let schedulesOpen = $state(false);
  async function closePersona() {
    editingPersona = false;
    // The Personas page shares the editor; give it back its list, not this chat's layer.
    client.personas.collection();
    if (doc?.personaChanged && doc.status === "idle") await session?.reload();
  }
  // While running, an extension may relabel, re-animate or hide the working indicator.
  const working = $derived(info?.status === "running" ? doc?.extensions.working : undefined);
  // "Opening…" only when opening takes long enough to notice, so a quick switch shows nothing.
  let slowOpening = $state(false);
  $effect(() => {
    if (!session?.opening) return void (slowOpening = false);
    const timer = setTimeout(() => (slowOpening = true), 300);
    return () => clearTimeout(timer);
  });
  const connection = $derived(session ? client.connection : "");
  // A question waiting or a queued prompt is said as it is; otherwise an extension may word it.
  const marked = $derived(sessionStatus(info));
  const status = $derived(
    (session?.opening && slowOpening) || client.connection === "Connecting" || client.connection === "Loading"
      ? "Opening…"
      : working?.hidden
        ? ""
        : marked === "Waiting for you" || marked === "Queued"
          ? marked
          : (working?.message ?? marked),
  );
  // An extension's window title names the browser tab while this chat is open.
  $effect(() => {
    const title = doc?.extensions.title;
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  });
  const modelName = $derived(
    client.providers.catalog.providers
      .find((p) => p.id === doc?.model?.provider)
      ?.models.find((m) => m.id === doc?.model?.id)?.name,
  );
  // The conversation is PiSpark's own view; extensions offer the others (`session.view`).
  const views = $derived([
    { value: "", label: "Conversation" },
    ...(session?.views ?? []).map((view) => ({ value: view.key, label: view.title ?? view.key })),
  ]);
  // A command runs as if it were typed in the reply box and sent, so it needs what a reply needs.
  const ready = $derived(doc?.status === "idle" && session?.connection === "Live" && !client.busy);
  const commands = $derived(
    (doc?.commands ?? []).map(({ name, description }) => ({
      id: name,
      label: description ? `${name} — ${description}` : name,
      disabled: !ready,
      onselect: () => void session?.send(`/${name}`),
    })),
  );
  const button = "conversation-action";
</script>

<header class="pb-5 border-b border-[var(--border)]">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <!-- The name keeps a readable width: when it would not, the controls go under it. -->
    <div class="min-w-0 flex-[1_1_16rem]">
      <div class="flex items-center gap-3 flex-wrap">
        <h1 class="text-2xl font-semibold tracking-tight text-foreground break-words">
          {info ? sessionName(info) : "New chat"}
        </h1>
        {#if status}<span role="status" class="chat-status" class:custom-indicator={!!working?.frames}
            >{#if working?.frames}<WorkingFrames frames={working.frames} intervalMs={working.intervalMs} />{/if}{status}</span
          >{/if}
        {#if session}<ContributionPoint point="session.title" />{/if}
      </div>
      {#if info}<p class="text-sm text-muted-foreground mt-1.5">
          {[
            info.persona.layered
              ? `${info.persona.name} (edited here)`
              : // Not said twice when the session goes by its app's name.
                goesByApp(info)
                ? undefined
                : info.persona.name,
            folderName(info.folder),
            modelName,
            sessionStarted(info),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>{:else}<p class="text-sm text-muted-foreground mt-1.5">
          Ask anything in the bar above to start a chat.
        </p>{/if}
    </div>
    {#if session}<div class="ml-auto flex flex-wrap items-start justify-end gap-3">
        {#if views.length > 1}<Segmented
            label="Show"
            options={views}
            value={session.shownView ?? ""}
            onchange={(key) => session.showView(key || undefined)}
          />{/if}
        {#if doc && ["running", "cancelling"].includes(doc.status)}<Button
            class={button}
            aria-label="Stop response"
            onclick={() => session.stop()}>Stop</Button
          >{:else if doc?.status === "queued"}<Button
            class={button}
            aria-label="Cancel queued message"
            onclick={() => session.stop()}>Cancel</Button
          >{/if}
        <SessionDetails oneditpersona={() => (editingPersona = true)} onschedules={() => (schedulesOpen = true)} />
        {#if commands.length}<Menu label="Commands" items={commands} />{/if}
      </div>{/if}
  </div>
</header>
{#if session}
  {#if doc?.extensions.header}<StyledText class="extension-header" lines={doc.extensions.header} />{/if}
  <ContributionPoint point="session.header" />
  {#if editingPersona && info}<InlinePanel
      label="Persona for this chat"
      title="Persona for this chat"
      help="Changes apply to this chat only. Closing reloads the chat with them; your messages stay."
      size="wide"
      onclose={() => void closePersona()}
    >
      <PersonaEditor target={{ chat: session.id }} embedded />
    </InlinePanel>{/if}
  {#if schedulesOpen && info}<InlinePanel
      label="Schedules for this chat"
      title="Schedules for this chat"
      help="Each run sends its prompt to this chat as if you typed it, with this chat’s persona and tools, even while the browser is closed."
      size="wide"
      onclose={() => (schedulesOpen = false)}
    >
      <SchedulesPanel sessionId={session.id} />
    </InlinePanel>{/if}
  {#if doc?.personaChanged && !editingPersona}<p role="status" class="conversation-notice flex flex-wrap items-center gap-3">
      <span class="flex-1">The persona changed. Reload to apply it; your messages stay.</span>
      <Button
        class={button}
        unavailable={doc.status === "idle" ? undefined : "Wait for the reply to finish"}
        onclick={() => session.reload()}>Reload chat</Button
      >
    </p>{/if}
  {#if info && connection === "Disconnected"}<p role="alert" class="conversation-notice">
      Connection lost. Your chat may still be running. <Button class={button} onclick={() => client.reconnect()}>Reconnect</Button>
    </p>
  {:else if info && connection === "Unloaded"}<p role="status" class="conversation-notice">
      This chat couldn’t be opened. <Button class={button} onclick={() => client.reconnect()}>Try again</Button>
    </p>
  {:else if info && connection === "Reconnecting"}<p role="status" class="conversation-notice">Reconnecting…</p>{/if}
  {#if doc?.interrupted}<p role="status" class="conversation-notice">
      This chat was interrupted. Your saved messages are still here.
    </p>{/if}
  {#if doc?.error}<p role="alert" class="conversation-notice">
      Something went wrong. Reopen this chat to try again.
    </p>{/if}
  {#if session.shownView && info?.waiting}<p role="status" class="conversation-notice flex flex-wrap items-center gap-3">
      <span class="flex-1">This chat is waiting for your answer.</span>
      <Button class={button} onclick={() => session.showView()}>Show conversation</Button>
    </p>{/if}
{/if}

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
