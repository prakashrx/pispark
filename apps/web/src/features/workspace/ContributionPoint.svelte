<script lang="ts">
  import { contributionsFor, loadView } from "./extension-views";
  import { useSession } from "./session-client.svelte";

  /**
   * One of a session's contribution points: draws what extensions contributed here, in the order
   * they did. Every component gets the same things: `session` (the session it is part of: its
   * state, its items as they stream, and send, stop and answer), `data` (what this point draws,
   * when it has something: a tool call, a custom item), `host` (whose `call(name, data)` runs a
   * function its own placement gave it, and whose `file(path)` is the address of a file in the
   * folder that placement named) and the props its extension sent. PiSpark owns the frame around
   * them. `only` draws just the contribution with that key: the one view that shows.
   */
  let { point, data, only }: { point: string; data?: unknown; only?: string } = $props();
  const session = useSession();
  const contributions = $derived(
    contributionsFor(session.doc?.extensions, point).filter((contribution) => only === undefined || contribution.key === only),
  );
  // One host per placement: it can reach only that placement's functions.
  const hostFor = (key: string) => ({
    call: (name: string, payload?: unknown) => session.call(point, key, name, payload),
    file: (path: string) => session.fileUrl(point, key, path),
  });
  const propsOf = (props: unknown): Record<string, unknown> =>
    props && typeof props === "object" && !Array.isArray(props)
      ? (props as Record<string, unknown>)
      : props === undefined
        ? {}
        : { props };
</script>

{#each contributions as contribution (contribution.key)}
  <div class="extension-view" data-point={point}>
    {#await loadView(contribution.url) then View}
      <svelte:boundary>
        <View {...propsOf(contribution.props)} {data} {session} host={hostFor(contribution.key)} />
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
  /* A whole view fills the session's area and grows past it; what is inside is the extension's. */
  .extension-view[data-point="session.view"] {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }
  /* Small things in a row: chips beside the chat title, actions beside Send. */
  .extension-view[data-point="session.title"],
  .extension-view[data-point="session.input.actions"] {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    overflow: hidden;
  }
  /* Around the reply box, the same spacing as widgets there; the first one clears the dock's fade. */
  .extension-view[data-point="session.input.above"] {
    padding: 0 0.5rem;
    margin-bottom: 0.625rem;
  }
  .extension-view[data-point="session.input.above"]:first-child {
    padding-top: 1rem;
  }
  .extension-view[data-point="session.input.below"] {
    padding: 0 0.5rem;
    margin-top: 0.5rem;
  }
  .extension-view[data-point="session.status"] {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .extension-view-failed {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
</style>
