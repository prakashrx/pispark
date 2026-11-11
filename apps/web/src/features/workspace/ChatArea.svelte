<script lang="ts">
  import ChatFrontend from "./ChatFrontend.svelte";
  import ChatHeader from "./ChatHeader.svelte";
  import type { ChatSession } from "./chat-session.svelte";
  import { provideChat } from "./session-client.svelte";
  import ViewSlot from "./ViewSlot.svelte";

  /**
   * Hosts one chat. It gives the chat to whatever draws it and chooses the frontend: PiSpark's own
   * (the conversation and the reply box), or the one an extension supplied in the `chat.page` slot.
   * Both are given the same `ChatSession` and nothing else of the app. Made anew for each chat.
   */
  let { chat }: { chat: ChatSession } = $props();
  // svelte-ignore state_referenced_locally
  provideChat(chat);
</script>

{#if chat.showingPage}
  <!-- An extension's frontend has the whole area under the chat's header. -->
  <main id="workspace" aria-label="Chat page" class="flex-1 min-h-0 overflow-hidden flex flex-col items-center">
    <div class="w-full max-w-3xl flex flex-col gap-8 px-6 pt-8 pb-5"><ChatHeader /></div>
    <div class="chat-page"><ViewSlot slot="chat.page" /></div>
  </main>
{:else}
  <ChatFrontend />
{/if}

<style>
  .chat-page {
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
</style>
