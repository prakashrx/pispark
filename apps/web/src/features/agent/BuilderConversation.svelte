<script lang="ts">
  /**
   * The Agent Builder session's conversation and reply box: PiSpark's own, given the session and
   * this panel as the place that scrolls. Nothing here is specific to agents.
   */
  import { setContext } from "svelte";
  import Conversation from "../workspace/Conversation.svelte";
  import Composer from "../workspace/Composer.svelte";
  import type { Session } from "../workspace/session.svelte";
  import { provideSession } from "../workspace/session-client.svelte";

  let { session }: { session: Session } = $props();
  // svelte-ignore state_referenced_locally
  provideSession(session);
  let scroller = $state<HTMLElement>();
  setContext("screen", {
    get main() {
      return scroller;
    },
  });
</script>

<div class="conversation" bind:this={scroller}>
  <Conversation />
</div>
<div class="reply">
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
  .reply {
    padding: 0 0.75rem 0.75rem;
  }
</style>
