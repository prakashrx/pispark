<script lang="ts">
  import SessionHeader from "./SessionHeader.svelte";
  /** The workspace with no chat open. */
</script>

<main id="workspace" aria-label="Chat conversation" class="flex-1 overflow-y-auto px-6 pt-8 pb-6 flex flex-col items-center">
  <div class="w-full max-w-3xl flex flex-col gap-8">
    <SessionHeader />
    <div class="h-10"></div>
  </div>
</main>
