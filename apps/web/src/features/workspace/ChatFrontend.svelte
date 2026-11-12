<script lang="ts">
  import Composer from "./Composer.svelte";
  import Conversation from "./Conversation.svelte";
  import ReplyExtensions from "./ReplyExtensions.svelte";

  /**
   * PiSpark's own view of a session: the conversation, and the reply box with what extensions
   * show around it. It reads the chat it is given (`useChat`) and nothing else about chats.
   */
</script>

<Conversation />
<footer class="reply-dock px-6 pb-5 pt-2 flex flex-col items-center w-full z-10">
  <div class="w-full max-w-3xl relative">
    <ReplyExtensions placement="above" />
    <Composer mode="reply" />
    <ReplyExtensions placement="below" />
  </div>
</footer>

<style>
  .reply-dock {
    background: linear-gradient(to bottom, transparent, var(--background) 1.25rem);
    margin-top: -1.25rem;
  }
</style>
