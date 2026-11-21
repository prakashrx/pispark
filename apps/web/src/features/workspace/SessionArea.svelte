<script lang="ts">
  import { focusMain } from "../../lib/focus";
  import Conversation from "./Conversation.svelte";
  import ContributionPoint from "./ContributionPoint.svelte";
  import type { Session } from "./session.svelte";

  /**
   * Hosts one session. It gives the session to whatever draws it and shows the view the person
   * chose: PiSpark's own (the conversation and the reply box), or one an extension offers as
   * `session.view`. Every view is given the same `Session` and nothing else of the app. Made
   * anew for each session.
   */
  let { session }: { session: Session } = $props();
  const view = $derived(session.views.find((offer) => offer.key === session.shownView));

  // Another view draws the area again, so focus that was inside it would fall to the page. It
  // stays on the switch when the person used that; otherwise it moves to the new main region.
  const SWITCH = '[role="radiogroup"][aria-label="Show"]';
  // svelte-ignore state_referenced_locally
  let shown = session.shownView;
  let onSwitch = false;
  $effect.pre(() => {
    if (session.shownView !== shown) onSwitch = !!document.activeElement?.closest(SWITCH);
  });
  $effect(() => {
    if (session.shownView === shown) return;
    shown = session.shownView;
    if (document.activeElement !== document.body) return;
    if (onSwitch) document.querySelector<HTMLElement>(`${SWITCH} input:checked`)?.focus();
    else focusMain();
  });
</script>

{#if view}
  <!-- An extension's view has the whole area under the session's header. -->
  <div class="session-view" aria-label={view.title} role="region">
    <ContributionPoint point="session.view" only={view.key} />
  </div>
{:else}
  <Conversation />
{/if}

<style>
  .session-view {
    flex: 1;
    min-height: 0;
    min-width: 0;
    width: 100%;
    container-type: inline-size;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
</style>
