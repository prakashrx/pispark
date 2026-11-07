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
  style="background:var(--background);color:var(--foreground)"
  class="app-shell flex w-full font-sans antialiased"
>
  {#if sidebarOpen}
    <aside
      style="background:var(--sidebar);border-right:1px solid var(--sidebar-border)"
      class="app-sidebar w-[272px] flex-shrink-0 flex flex-col min-h-0 select-none"
      aria-label="Application sidebar"
    >
      <div
        class="header-brand h-16 px-4 flex items-center justify-between shrink-0"
      >
        <a href="#/workspace" class="flex items-center gap-2.5 rounded-lg">
          <span class="brand-mark" aria-hidden="true">π</span>
          <span class="text-[17px] font-semibold tracking-tight">PiSpark</span>
          <span
            class={[
              "inline-flex h-2 w-2 rounded-full",
              sessions.connection === "Connected" || sessions.connection === "Reconnecting"
                ? "bg-emerald-500"
                : sessions.connection === "Disconnected"
                  ? "bg-red-500"
                  : "bg-amber-400 animate-pulse"
            ].join(" ")}
            role="img"
            aria-label={`Backend: ${sessions.connection}`}
            title={`Backend: ${sessions.connection}`}
          ></span>
        </a>
        <Button
          class="p-2 rounded-lg border-0 bg-transparent hover:bg-[var(--sidebar-accent)] text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Collapse sidebar"
          aria-expanded="true"
          onclick={toggleSidebar}
          ><Icon name="collapse" class="w-[18px] h-[18px]" /></Button
        >
      </div>
      {@render sidebar()}
    </aside>
  {/if}
  <div
    class="app-content flex-1 flex flex-col h-full overflow-hidden min-w-0"
  >
    <header
      style="border-bottom:1px solid var(--border);background:color-mix(in srgb, var(--background) 85%, transparent)"
      class="global-header h-16 px-5 flex items-center justify-between flex-shrink-0 backdrop-blur-sm z-20"
    >
      {#if !sidebarOpen}<Button
          class="mr-2 p-2 rounded-lg border-0 bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Expand sidebar"
          aria-expanded="false"
          onclick={toggleSidebar}
          ><Icon name="collapse" class="w-[18px] h-[18px] rotate-180" /></Button
        >{/if}
      <div class="w-full flex items-center gap-2 min-w-0"><Composer quiet={!!sessions.selected} /></div>
    </header>
    {#if sessions.listNotice}<p
        role="status"
        class="notice" data-tone="info"
      >
        {sessions.listNotice}
      </p>{/if}
    {#if sessions.error}<div
        role="alert"
        class="notice break-words" data-tone="danger"
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
        class="notice break-words" data-tone="danger"
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

<style>
  .brand-mark {
    display: inline-grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.5rem;
    background: var(--brand-gradient);
    color: white;
    font-size: 1rem;
    font-weight: 700;
    line-height: 1;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  }
  .notice {
    margin: 0.75rem 1.25rem 0;
    padding: 0.625rem 0.875rem;
    border-radius: var(--radius);
    font-size: 0.875rem;
    line-height: 1.5;
  }
  .notice[data-tone="info"] {
    background: var(--interactive-muted);
    color: var(--foreground);
  }
  .notice[data-tone="danger"] {
    background: var(--danger-muted);
    color: var(--danger-foreground);
  }
  .notice :global(summary) {
    cursor: pointer;
    font-size: 0.8125rem;
    margin-top: 0.25rem;
  }
</style>
