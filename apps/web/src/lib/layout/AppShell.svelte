<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import Composer from "../../features/workspace/Composer.svelte";
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
              class="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
              role="img"
              aria-label="Fixture status indicator; backend not connected"
              title="Fixture status; backend not connected"
            ></span>PiSpark
          </span>
          <span
            class="px-1.5 py-0.5 text-[10px] font-medium bg-zinc-200/60 text-zinc-600 rounded"
            >v0.9</span
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
    {@render children()}
  </div>
</div>
