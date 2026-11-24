<script lang="ts">
  /**
   * The Agent Builder session's conversation and reply box: PiSpark's own, given the session and
   * this panel as the place that scrolls. Nothing here is specific to agents.
   */
  import { onMount, setContext, tick } from "svelte";
  import Conversation from "../workspace/Conversation.svelte";
  import Composer from "../workspace/Composer.svelte";
  import type { Session } from "../workspace/session.svelte";
  import { provideSession } from "../workspace/session-client.svelte";

  let { session, held }: { session: Session; /** Why sending waits, said above the reply box. */ held?: string } = $props();
  // svelte-ignore state_referenced_locally
  provideSession(session);
  let scroller = $state<HTMLElement>();
  setContext("screen", {
    get main() {
      return scroller;
    },
  });
  let reply = $state<HTMLElement>();
  // Opening Agent Builder is to ask it something: the reply box takes the focus.
  onMount(async () => {
    await tick();
    reply?.querySelector<HTMLElement>('[contenteditable="true"], textarea')?.focus();
  });
</script>

<div class="conversation" bind:this={scroller}>
  <Conversation />
</div>
<div class="reply" bind:this={reply}>
  {#if held}<p class="held" role="status">{held}</p>{/if}
  <Composer mode="reply" />
</div>

<style>
  .conversation {
    flex: 1;
    min-height: 12rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.5rem 0.75rem;
  }
  .held {
    margin-bottom: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--warning-foreground) 10%, transparent);
    font-size: var(--text-sm);
  }
  .reply {
    padding: 0 0.75rem 0.75rem;
  }
</style>
