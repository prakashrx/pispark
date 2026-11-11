<script lang="ts">
  import { contributionsFor, loadView } from "./extension-views";
  import { useSessions } from "./session-client.svelte";

  /**
   * One of the chat's contribution points: draws what extensions placed here, in the order they
   * placed it. Every component gets the same three things: `data` (what this place draws, when it
   * has something: a tool call, a custom item), `host` (whose `call(name, data)` runs a function its
   * own placement gave it, and whose `file(path)` is the address of a file in the folder that
   * placement named) and the props its extension sent. PiSpark owns the frame around them.
   */
  let { slot, data }: { slot: string; data?: unknown } = $props();
  const client = useSessions();
  const contributions = $derived(contributionsFor(client.snapshot?.extensions, slot));
  // One host per placement: it can reach only that placement's functions.
  const hostFor = (key: string) => ({
    call: (name: string, payload?: unknown) => client.call(slot, key, name, payload),
    file: (path: string) => client.fileUrl(slot, key, path),
  });
  const propsOf = (props: unknown): Record<string, unknown> =>
    props && typeof props === "object" && !Array.isArray(props)
      ? (props as Record<string, unknown>)
      : props === undefined
        ? {}
        : { props };
</script>

{#each contributions as contribution (contribution.key)}
  <div class="extension-view" data-slot={slot}>
    {#await loadView(contribution.url) then View}
      <svelte:boundary>
        <View {...propsOf(contribution.props)} {data} host={hostFor(contribution.key)} />
        {#snippet failed()}<span class="extension-view-failed" role="status">This extension view stopped working.</span>{/snippet}
      </svelte:boundary>
    {:catch}
      <span class="extension-view-failed" role="status">This extension view could not load.</span>
    {/await}
  </div>
{/each}

<style>
  .extension-view {
    min-width: 0;
  }
  /* The page fills the chat area and grows past it; what is inside is the extension's. */
  .extension-view[data-slot="chat.page"] {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }
  /* Small things in a row: chips beside the chat title, actions beside Send. */
  .extension-view[data-slot="chat.title"],
  .extension-view[data-slot="reply.actions"] {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    overflow: hidden;
  }
  /* Around the reply box, the same spacing as widgets there; the first one clears the dock's fade. */
  .extension-view[data-slot="reply.above"] {
    padding: 0 0.5rem;
    margin-bottom: 0.625rem;
  }
  .extension-view[data-slot="reply.above"]:first-child {
    padding-top: 1rem;
  }
  .extension-view[data-slot="reply.below"] {
    padding: 0 0.5rem;
    margin-top: 0.5rem;
  }
  .extension-view[data-slot="reply.footer"] {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .extension-view-failed {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
</style>
