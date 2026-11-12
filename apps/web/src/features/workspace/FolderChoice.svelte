<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { useSessions } from "./session-client.svelte";
  import { folderName } from "./chat-presentation";
  // The choice of a working folder: any existing folder on the backend host, from the recent
  // ones, home, or a path typed in. Ask and the persona editor share it.
  let {
    value = $bindable(""),
    display = "compact",
    none,
    locked,
  }: {
    value?: string;
    display?: "field" | "compact";
    /** What "no folder" is called, where that is a choice. */
    none?: string;
    /** Why the folder is not a choice here: it is shown, with this reason. */
    locked?: string;
  } = $props();
  const sessions = useSessions();
  let other = $state("");
  const options = $derived([
    ...(none ? [{ value: "", label: none }] : []),
    ...[...new Set([value, ...sessions.catalog.recentFolders, sessions.catalog.home].filter(Boolean))].map((folder) => ({
      value: folder,
      label: folder,
    })),
  ]);
</script>

{#snippet chip(label: string)}
  <Icon name="folder" class="w-4 h-4" />
  <span class="max-w-36 truncate" title={label}>{folderName(label)}</span>
  <Icon name={locked ? "lock" : "chevronDown"} class="w-3.5 h-3.5 opacity-60" />
{/snippet}

{#if locked}
  <Button class="folder-locked" unavailable={locked} aria-label={`Working folder: ${value}. ${locked}`}
    >{@render chip(value)}</Button
  >
{:else}
  <Selector label="Working folder" {options} bind:value searchable {display} children={display === "compact" ? chip : undefined}>
    {#snippet footer(close)}
      <form
        class="flex items-end gap-2 w-[min(22rem,80vw)]"
        aria-label="Use another folder"
        onsubmit={(event) => {
          event.preventDefault();
          if (!other.trim()) return;
          value = other.trim();
          other = "";
          close();
        }}
      >
        <div class="flex-1 min-w-0">
          <Input label="Another folder" placeholder="Full path on this computer" density="compact" bind:value={other} />
        </div>
        <Button size="compact" type="submit">Use</Button>
      </form>
    {/snippet}
  </Selector>
{/if}

<style>
  /* A locked folder is a value to read, not an action that is unavailable: the lock says the rest. */
  :global(.ui-button.folder-locked) {
    opacity: 1;
    cursor: default;
  }
</style>
