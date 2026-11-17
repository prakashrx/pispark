<script lang="ts">
  /**
   * New session (set 2). Where there's room the greeting and the composer sit together in the
   * middle of the screen; on a phone the composer stays at the bottom, under the thumb. The
   * folder, agent and model sit under the composer.
   */
  import Screen from "../../shell/Screen.svelte";
  import { layout } from "../../shell/layout.svelte";
  import Composer from "./Composer.svelte";
  import { useSessions } from "./session-client.svelte";

  const sessions = useSessions();
  // Truthful first run: without a model to use, say so and point at where one is set up.
  const noModel = $derived(sessions.providers.noModel);
</script>

{#snippet greeting()}
  {#if noModel}
    <h2 class="greeting">Connect a provider to start</h2>
    <p class="hint">PiSpark needs an account with a model provider, such as OpenAI or Anthropic. It takes a minute.</p>
    <a class="ui-button" data-variant="primary" href="#/settings/providers">Set up a provider</a>
  {:else}
    <h2 class="greeting">What should we work on?</h2>
  {/if}
{/snippet}

{#if layout.size === "compact"}
  <Screen title="New session">
    <div class="alone">{@render greeting()}</div>
    {#snippet dock()}<Composer />{/snippet}
  </Screen>
{:else}
  <Screen title="New session">
    <div class="together">
      {@render greeting()}
      <div class="box"><Composer /></div>
    </div>
  </Screen>
{/if}

<style>
  .alone,
  .together {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    text-align: center;
  }
  .alone {
    min-height: calc(100dvh - 16rem);
  }
  .together {
    min-height: calc(100dvh - 10rem);
    gap: 1.25rem;
  }
  .box {
    width: 100%;
    max-width: 44rem;
    text-align: left;
  }
  .greeting {
    font-size: var(--text-2xl);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .hint {
    max-width: 30rem;
    font-size: var(--text-md);
    color: var(--muted-foreground);
  }
</style>
