<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { folders, personas, styles, models } from "./fixtures";
  let {
    mode = "ask",
    draft = $bindable(""),
  }: {
    mode?: "ask" | "reply";
    draft?: string;
  } = $props();
  let folder = $state("D:/dev/pispark");
  let persona = $state("Developer");
  let style = $state("Concise");
  let model = $state("balanced");
  const pill =
    "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-white hover:bg-zinc-50 border border-zinc-200 rounded-lg transition-colors shadow-elevation-sm";
</script>

<form
  class="composer w-full bg-zinc-50 border border-zinc-200/80 rounded-full px-3 py-1.5 flex items-center gap-2 transition-all shadow-elevation-sm focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-950/5 focus-within:bg-white"
  class:composer-reply={mode === "reply"}
  aria-label={mode === "ask" ? "New session draft" : "Session reply draft"}
  onsubmit={(event) => event.preventDefault()}
>
  {#if mode === "reply"}
    <Button
      aria-label="Add context"
      unavailable="Context attachments require the backend"
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
      label={mode === "ask"
        ? "Ask anything (local draft)"
        : "Reply to Workspace review (local draft)"}
      bind:value={draft}
      class="w-full text-xs bg-transparent border-none p-0 text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-0 focus:border-transparent outline-none font-sans min-w-0"
      placeholder={mode === "ask"
        ? "Ask anything, or start a new session..."
        : "Reply to Workspace review..."}
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
        options={folders}
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
      <Selector
        label="Persona"
        options={personas}
        bind:value={persona}
        class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-800 bg-zinc-100 hover:bg-zinc-200/70 border border-zinc-200 rounded-lg transition-colors"
      >
        {#snippet children(value)}
          <Icon name="person" class="w-3.5 h-3.5 text-zinc-600" />
          <span>{value}</span>
          <Icon name="chevronDown" class="w-3 h-3 text-zinc-400" />
        {/snippet}
      </Selector>
      {#if persona === "Developer"}
        <Selector
          label="Style"
          options={styles}
          bind:value={style}
          class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 bg-white hover:bg-zinc-50 border border-zinc-200 rounded-lg transition-colors"
        >
          {#snippet children(value)}<span>{value}</span><Icon
              name="chevronDown"
              class="w-3 h-3 text-zinc-400"
            />{/snippet}
        </Selector>
      {/if}
      <Selector label="Model" options={models} bind:value={model} class={pill}>
        {#snippet children(value)}
          <Icon name="model" class="w-3.5 h-3.5 text-zinc-500" />
          <span>{value}</span>
          <Icon name="chevronDown" class="w-3 h-3 text-zinc-400" />
        {/snippet}
      </Selector>
    {/if}
    <Button
      aria-label={mode === "reply" ? "Send reply" : "Run"}
      unavailable="Backend not connected; draft is not sent"
      class="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-800 transition-colors shadow-sm ml-0.5 active:scale-95 flex-shrink-0"
      ><Icon name="arrowUp" class="w-4 h-4" /></Button
    >
  </div>
</form>
