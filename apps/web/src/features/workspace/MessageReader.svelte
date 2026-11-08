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
    <pre bind:this={text} tabindex="-1" class="whitespace-pre-wrap break-words">{page.text}</pre>
    {#if page.next}<Button
        disabled={busy}
        onclick={() => read(page!.next!.part, page!.next!.offset)}
        >Next page</Button
      >{/if}
    <Button
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
  <Button id={triggerId} disabled={busy} onclick={() => read()}>Read full message</Button>
{/if}
{#if error}<p role="alert">{error}</p>{/if}
