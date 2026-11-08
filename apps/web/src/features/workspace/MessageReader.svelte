<script lang="ts">
  import { tick } from "svelte";
  import type {
    MessagePage,
    MessageRef,
  } from "../../../../server/src/protocol";
  import Button from "../../lib/ui/Button.svelte";
  import { useSessions } from "./session-client.svelte";
  let { reference }: { reference: MessageRef } = $props();
  const client = useSessions();
  let page = $state<MessagePage>();
  let busy = $state(false);
  let error = $state("");
  const triggerId = $props.id();
  let text = $state<HTMLPreElement>();
  async function read(part = 0, offset = 0) {
    if (busy) return;
    busy = true;
    error = "";
    try {
      page = await client.readMessage(reference, part, offset);
      await tick();
      text?.focus();
    } catch {
      error = "Couldn’t read this message. Reopen the chat and try again.";
    } finally {
      busy = false;
    }
  }
</script>

{#if page}
  <section aria-label="Full message text" class="space-y-2">
    <pre bind:this={text} tabindex="-1" class="full-text">{page.text}</pre>
    {#if page.next}<Button
        class="conversation-action"
        disabled={busy}
        onclick={() => read(page!.next!.part, page!.next!.offset)}
        >Next page</Button
      >{/if}
    <Button
      class="conversation-action"
      disabled={busy}
      onclick={async () => {
        page = undefined;
        error = "";
        await tick();
        document.getElementById(triggerId)?.focus();
      }}>Close full text</Button
    >
  </section>
{:else}
  <Button id={triggerId} class="conversation-action" disabled={busy} onclick={() => read()}>Read full message</Button>
{/if}
{#if error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}

<style>
  /* Reads like the reply above it. Focus moves here so screen readers start on
     the new text; it is not a control, so it shows no focus frame. */
  .full-text {
    font-family: var(--font-reading);
    font-size: 1rem;
    line-height: 1.75;
    color: var(--foreground);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .full-text:focus {
    outline: none;
  }
</style>
