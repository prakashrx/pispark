<script lang="ts">
  /**
   * The session ⋯ menu's Commands… (design set 7/3): the commands the session's extensions registered,
   * filtered as you type; choosing one runs it as if it were typed and sent.
   */
  import Modal from "../../lib/ui/Modal.svelte";
  import type { SessionCommand } from "../../../../server/src/contract/protocol";

  let {
    commands,
    ready,
    onrun,
    onclose,
  }: { commands: SessionCommand[]; ready: boolean; onrun: (name: string) => void; onclose: () => void } = $props();
  let query = $state("");
  const shown = $derived(
    commands.filter(({ name, description }) => `${name} ${description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  function run(name: string) {
    onclose();
    onrun(name);
  }
</script>

<Modal label="Commands" title="Commands" {onclose} initialFocus="#command-filter">
  <input
    id="command-filter"
    class="filter"
    type="search"
    aria-label="Filter commands"
    placeholder="Type to filter…"
    bind:value={query}
    onkeydown={(event) => {
      if (event.key === "Enter" && shown[0] && ready) {
        event.preventDefault();
        run(shown[0].name);
      }
    }}
  />
  {#if !ready}<p class="note">Commands run when the session is ready for a message.</p>{/if}
  <ul class="list" aria-label="Commands">
    {#each shown as command (command.name)}<li>
        <button type="button" class="command" disabled={!ready} onclick={() => run(command.name)}>
          <span class="name">/{command.name}</span>{#if command.description}{" "}<span class="description">{command.description}</span>{/if}
        </button>
      </li>
    {:else}<li class="note">Nothing matches “{query}”.</li>{/each}
  </ul>
</Modal>

<style>
  .filter {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--input);
    border-radius: var(--radius-md);
    background: var(--background);
    color: var(--foreground);
    font: inherit;
    font-size: var(--text-sm);
  }
  .filter:focus-visible {
    outline: none;
    border-color: var(--interactive);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--interactive) 25%, transparent);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin-top: 0.5rem;
    max-height: 50dvh;
    overflow-y: auto;
  }
  .command {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 0.5rem 0.625rem;
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .command:hover:not(:disabled),
  .command:focus-visible {
    background: var(--accent);
  }
  .command:disabled {
    opacity: 0.6;
  }
  .name {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .description {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .note {
    margin-top: 0.5rem;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
</style>
