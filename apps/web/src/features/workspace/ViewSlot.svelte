<script lang="ts">
  import { contributionsFor, loadView } from "./extension-views";
  import { useSessions } from "./session-client.svelte";

  /**
   * One of the chat's contribution points: mounts what extensions placed here. A component gets
   * the props its extension sent, the slot's own data (a tool call, a custom entry) and `emit`,
   * which raises an event on the chat's Pi event bus for its extension to hear.
   */
  let { slot, data = {} }: { slot: string; data?: Record<string, unknown> } = $props();
  const client = useSessions();
  const contributions = $derived(contributionsFor(client.snapshot?.extensions, slot));
  const emit = (name: string, payload?: unknown) => client.emit(name, payload);
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
        <View {...propsOf(contribution.props)} {...data} {emit} />
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
