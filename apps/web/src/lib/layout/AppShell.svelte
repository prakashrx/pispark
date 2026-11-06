<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import Composer from "../../features/workspace/Composer.svelte";
  import { useSessions } from "../../features/workspace/session-client.svelte";
  import {
    chatName,
    commandUncertainty,
  } from "../../features/workspace/chat-presentation";
  const sessions = useSessions();
  const displayedChat = $derived(
    sessions.snapshot ??
      sessions.sessions.find((s) => s.id === sessions.selected),
  );
  const reconnectWorkspace = $derived(
    sessions.connection === "Disconnected" && !displayedChat,
  );
  let { sidebar, children }: { sidebar: Snippet; children: Snippet } = $props();
  let sidebarOpen = $state(true);
  let shell: HTMLDivElement;

  async function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    await tick();
    shell
      .querySelector<HTMLButtonElement>(
        sidebarOpen
          ? '[aria-label="Collapse sidebar"]'
          : '[aria-label="Expand sidebar"]',
      )
      ?.focus();
  }
  function shortcut(event: KeyboardEvent) {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== "b" ||
      event.altKey
    )
      return;
    const target = event.target as HTMLElement;
    if (
      target.closest('input, textarea, select, [contenteditable="true"]') ||
      document.querySelector("dialog[open]")
    )
      return;
    event.preventDefault();
    toggleSidebar();
  }
</script>

<svelte:window onkeydown={shortcut} />
<div
  bind:this={shell}
  class="app-shell flex w-full bg-white text-zinc-900 font-sans antialiased selection:bg-zinc-200 selection:text-zinc-900"
>
  {#if sidebarOpen}
    <aside
      class="app-sidebar w-72 flex-shrink-0 border-r border-zinc-200/80 bg-[#fbfbfb] flex flex-col min-h-0 select-none"
      aria-label="Application sidebar"
    >
      <div
        class="header-brand h-14 px-4 flex items-center justify-between border-b border-zinc-200/60 shrink-0"
      >
        <a href="#/workspace" class="flex items-center space-x-2.5">
          <span
            class="font-semibold text-sm tracking-tight text-zinc-900 flex items-center gap-2"
          >
            <span
              class={[
                "inline-flex h-2 w-2 rounded-full",
                sessions.connection === "Connected" || sessions.connection === "Reconnecting"
                  ? "bg-emerald-500 animate-pulse"
                  : sessions.connection === "Disconnected"
                    ? "bg-red-400"
                    : "bg-amber-400"
              ].join(" ")}
              role="img"
              aria-label={`Backend: ${sessions.connection}`}
              title={`Backend: ${sessions.connection}`}
            ></span>PiSpark
          </span>
          <span
            class="px-1.5 py-0.5 text-[10px] font-medium bg-zinc-200/60 text-zinc-600 rounded"
            >v0.1</span
          >
        </a>
        <Button
          class="p-1.5 rounded-md hover:bg-zinc-200/60 text-zinc-500 hover:text-zinc-800 transition-colors"
          aria-label="Collapse sidebar"
          aria-expanded="true"
          onclick={toggleSidebar}
          ><Icon name="collapse" class="w-4 h-4" /></Button
        >
      </div>
      {@render sidebar()}
    </aside>
  {/if}
  <div
    class="app-content flex-1 flex flex-col h-full overflow-hidden bg-white min-w-0"
  >
    <header
      class="global-header h-14 border-b border-zinc-200/80 px-6 flex items-center justify-between flex-shrink-0 bg-white/80 backdrop-blur-sm z-20"
    >
      {#if !sidebarOpen}<Button
          class="mr-2 p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100"
          aria-label="Expand sidebar"
          aria-expanded="false"
          onclick={toggleSidebar}
          ><Icon name="collapse" class="w-4 h-4 rotate-180" /></Button
        >{/if}
      <div class="w-full flex items-center gap-2 min-w-0"><Composer /></div>
    </header>
    {#if sessions.listNotice}<p
        role="status"
        class="px-6 py-2 text-xs text-zinc-700"
      >
        {sessions.listNotice}
      </p>{/if}
    {#if sessions.error}<div
        role="alert"
        class="px-6 py-2 text-xs text-zinc-700 break-words"
      >
        <p>
          {commandUncertainty(sessions.errorKind, false) ||
            (reconnectWorkspace
              ? "Couldn’t connect to your workspace."
              : "Couldn’t complete that action. Your draft is still here.")}
        </p>
        {#if reconnectWorkspace}<Button
            class="source-action ml-2"
            onclick={() => sessions.reconnect()}>Reconnect</Button
          >{/if}
        <details class="mt-1">
          <summary>Details</summary>
          <p>{sessions.error}</p>
        </details>
      </div>{/if}
    {#if sessions.sessionErrors[sessions.selected]}<div
        role="alert"
        class="px-6 py-2 text-xs text-zinc-700 break-words"
      >
        <p>
          {chatName(sessions.sessions.find((s) => s.id === sessions.selected))}:
          <span
            >{commandUncertainty(
              sessions.sessionErrorKinds[sessions.selected],
              true,
            ) || "Something went wrong. Reopen this chat to try again."}</span
          >
        </p>
        <details class="mt-1">
          <summary>Details</summary>
          <p>{sessions.sessionErrors[sessions.selected]}</p>
        </details>
      </div>{/if}
    {@render children()}
  </div>
</div>
