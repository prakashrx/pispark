<script lang="ts">
  import { contributionsFor, loadView } from "./extension-views";
  import { useSessions } from "./session-client.svelte";

  /**
   * One of the chat's contribution points: mounts what extensions placed here. A component gets
   * the props its extension sent, the slot's own data (a tool call, a custom entry) and `host`,
   * whose `call(name, data)` runs one of the functions its own placement gave it.
   */
  let { slot, data = {} }: { slot: string; data?: Record<string, unknown> } = $props();
  const client = useSessions();
  const contributions = $derived(contributionsFor(client.snapshot?.extensions, slot));
  // One host per placement: it can reach only that placement's functions.
  const hostFor = (key: string) => ({
    call: (name: string, payload?: unknown) => client.call(slot, key, name, payload),
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
        <View {...propsOf(contribution.props)} {...data} host={hostFor(contribution.key)} />
        {#snippet failed()}<p class="extension-view-failed" role="status">This extension view stopped working.</p>{/snippet}
      </svelte:boundary>
    {:catch}
      <p class="extension-view-failed" role="status">This extension view could not load.</p>
    {/await}
  </div>
{/each}

<style>
  .extension-view {
    min-width: 0;
  }
  /* Around the reply box, the same spacing as widgets there. */
  .extension-view[data-slot="above-reply"] {
    padding: 0 0.5rem;
    margin-bottom: 0.625rem;
  }
  .extension-view[data-slot="below-reply"] {
    padding: 0 0.5rem;
    margin-top: 0.5rem;
  }
  .extension-view-failed {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
</style>
