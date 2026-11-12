<script lang="ts">
  import { focusMain } from "../../lib/focus";
  import ChatFrontend from "./ChatFrontend.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import SessionHeader from "./SessionHeader.svelte";
  import type { ChatSession } from "./chat-session.svelte";
  import { provideChat } from "./session-client.svelte";

  /**
   * Hosts one session. It gives the session to whatever draws it and shows the view the person
   * chose: PiSpark's own (the conversation and the reply box), or one an extension offers as
   * `session.view`. Every view is given the same `ChatSession` and nothing else of the app. Made
   * anew for each session.
   */
  let { chat }: { chat: ChatSession } = $props();
  // svelte-ignore state_referenced_locally
  provideChat(chat);
  const view = $derived(chat.views.find((offer) => offer.key === chat.shownView));

  // Another view draws the area again, so focus that was inside it would fall to the page. It
  // stays on the switch when the person used that; otherwise it moves to the new main region.
  const SWITCH = '[role="radiogroup"][aria-label="Show"]';
  // svelte-ignore state_referenced_locally
  let shown = chat.shownView;
  let onSwitch = false;
  $effect.pre(() => {
    if (chat.shownView !== shown) onSwitch = !!document.activeElement?.closest(SWITCH);
  });
  $effect(() => {
    if (chat.shownView === shown) return;
    shown = chat.shownView;
    if (document.activeElement !== document.body) return;
    if (onSwitch) document.querySelector<HTMLElement>(`${SWITCH} input:checked`)?.focus();
    else focusMain();
  });
</script>

{#if view}
  <!-- An extension's view has the whole area under the session's header. -->
  <main id="workspace" aria-label={view.title} class="flex-1 min-h-0 overflow-hidden flex flex-col items-center">
    <div class="w-full max-w-3xl flex flex-col gap-8 px-6 pt-8 pb-5"><SessionHeader /></div>
    <div class="session-view"><ContributionPoint point="session.view" only={view.key} /></div>
  </main>
{:else}
  <ChatFrontend />
{/if}

<style>
  .session-view {
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
</style>
